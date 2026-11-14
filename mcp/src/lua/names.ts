// Names a Lua file hands to the engine as hashes: input actions compared with action_id, and message names
// compared with message_id or sent with msg.post. Used by the cross-file checks (ddf/crosscheck.ts).
import luaparse from 'luaparse';
import messagesJson from './messages.generated.json' with { type: 'json' };
import { memberName, stringValue, walk, type Node } from './check.js';

export const BUILTIN_MESSAGES = new Set<string>((messagesJson as { messages: string[] }).messages);

export interface NameUse {
  name: string;
  line?: number;
  column?: number;
}

/** received: compared with message_id; posted: sent with msg.post; other: any other string literal. */
export type MessageRole = 'received' | 'posted' | 'other';

export interface MessageUse extends NameUse {
  role: MessageRole;
  /** The built-in message the name is one or two letters away from. */
  builtin: string;
}

export interface LuaNames {
  /** Names compared with action_id, e.g. `action_id == hash("jump")`. */
  actions: NameUse[];
  /** Every string literal that looks like a misspelled built-in message, with how the file uses it. */
  messages: MessageUse[];
}

const nearMemo = new Map<string, string | undefined>();

/**
 * The built-in message `name` is probably a misspelling of. Short names and plain inflections ("enabled",
 * "loads") are left alone: they are ordinary names for a game's own messages.
 */
export function misspelledBuiltin(name: string): string | undefined {
  if (nearMemo.has(name)) return nearMemo.get(name);
  let best: string | undefined;
  if (name.length >= 5 && !BUILTIN_MESSAGES.has(name) && /^[a-z0-9_]+$/i.test(name)) {
    const max = name.length >= 10 ? 2 : 1;
    let bestD = max + 1;
    for (const b of BUILTIN_MESSAGES) {
      if (b.length < 5 || Math.abs(b.length - name.length) > max) continue;
      const d = distance(name.toLowerCase(), b);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (best && [best + 'd', best + 'ed', best + 's'].includes(name)) best = undefined;
  }
  nearMemo.set(name, best);
  return best;
}

/** Edit distance where swapping two adjacent letters counts once ("respnose"), as typing slips usually do. */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

type Mark = 'received' | 'posted' | 'action';

/** The string literal inside hash("x") / hash "x". */
function hashedLiteral(expr: Node): Node | undefined {
  if (expr.type !== 'CallExpression' && expr.type !== 'StringCallExpression') return undefined;
  if (memberName(expr.base as Node) !== 'hash') return undefined;
  if (expr.type === 'StringCallExpression') return expr.argument as Node;
  const args = expr.arguments as Node[];
  return args.length === 1 && args[0]!.type === 'StringLiteral' ? args[0] : undefined;
}

/** What an identifier in a comparison stands for: the id parameter of on_message / on_input, by name or position. */
function subjectKind(name: string, ancestors: Node[]): 'message' | 'action' | undefined {
  if (name === 'message_id') return 'message';
  if (name === 'action_id') return 'action';
  for (const a of ancestors) {
    if (a.type !== 'FunctionDeclaration') continue;
    const fn = (a.identifier as Node | null)?.name;
    if ((fn === 'on_message' || fn === 'on_input') && (a.parameters as Node[])[1]?.name === name) return fn === 'on_message' ? 'message' : 'action';
  }
  return undefined;
}

export function luaNames(ast: Node): LuaNames {
  // `local JUMP = hash("jump")` constants: the usual way scripts name the ids they compare with.
  // A name declared twice or assigned later is ambiguous and not followed.
  const consts = new Map<string, Node | null>();
  walk(ast, [], (node) => {
    if (node.type === 'LocalStatement') {
      const init = (node.init as Node[] | undefined) ?? [];
      (node.variables as Node[]).forEach((v, i) => {
        const name = v.name as string;
        const lit = init[i] ? hashedLiteral(init[i]!) : undefined;
        consts.set(name, consts.has(name) || !lit ? null : lit);
      });
    } else if (node.type === 'AssignmentStatement') {
      for (const v of node.variables as Node[]) if (v.type === 'Identifier') consts.set(v.name as string, null);
    }
  });
  const constOf = new Map<Node, string>();
  for (const [name, lit] of consts) if (lit) constOf.set(lit, name);

  const marks = new Map<Node, Set<Mark>>();
  const mentions = new Map<string, number>(); // identifier nodes per constant, declaration included
  const marked = new Map<string, number>(); // of those, the ones in a marked position
  const literals: Node[] = [];
  const mark = (expr: Node | undefined, what: Mark): void => {
    if (!expr) return;
    let lit: Node | undefined;
    if (expr.type === 'Identifier') {
      lit = consts.get(expr.name as string) ?? undefined;
      if (lit) marked.set(expr.name as string, (marked.get(expr.name as string) ?? 0) + 1);
    } else {
      lit = hashedLiteral(expr) ?? (what === 'posted' && expr.type === 'StringLiteral' ? expr : undefined);
    }
    if (!lit) return;
    const set = marks.get(lit) ?? new Set<Mark>();
    set.add(what);
    marks.set(lit, set);
  };

  walk(ast, [], (node, ancestors) => {
    if (node.type === 'StringLiteral') literals.push(node);
    else if (node.type === 'Identifier' && consts.get(node.name as string)) mentions.set(node.name as string, (mentions.get(node.name as string) ?? 0) + 1);
    else if (node.type === 'BinaryExpression' && (node.operator === '==' || node.operator === '~=')) {
      const l = node.left as Node;
      const r = node.right as Node;
      for (const [subject, other] of [[l, r], [r, l]] as const) {
        const kind = subject.type === 'Identifier' ? subjectKind(subject.name as string, ancestors) : undefined;
        if (kind) mark(other, kind === 'message' ? 'received' : 'action');
      }
    } else if (node.type === 'CallExpression' && memberName(node.base as Node) === 'msg.post') {
      mark((node.arguments as Node[])[1], 'posted');
    }
  });

  const at = (lit: Node): NameUse => ({ name: stringValue(lit), line: lit.loc?.start.line, column: lit.loc ? lit.loc.start.column + 1 : undefined });
  const out: LuaNames = { actions: [], messages: [] };
  for (const lit of literals) {
    const set = marks.get(lit);
    if (set?.has('action')) out.actions.push(at(lit));
    const use = at(lit);
    const builtin = misspelledBuiltin(use.name);
    if (!builtin) continue;
    // A constant counts for what it is compared with or posted as only when that is all the file does with it.
    const name = constOf.get(lit);
    const escapes = name !== undefined && (mentions.get(name) ?? 0) - 1 !== (marked.get(name) ?? 0);
    const roles: MessageRole[] = !set || set.has('action') || escapes ? ['other'] : ([...set] as MessageRole[]);
    for (const role of roles) out.messages.push({ ...use, role, builtin });
  }
  return out;
}

/** luaNames for source text; undefined when the file does not parse. */
export function parseLuaNames(code: string, resource: string): LuaNames | undefined {
  try {
    return luaNames(luaparse.parse(code, { luaVersion: resource.endsWith('.editor_script') ? '5.2' : 'LuaJIT', locations: true, comments: false, scope: false }) as unknown as Node);
  } catch {
    return undefined;
  }
}
