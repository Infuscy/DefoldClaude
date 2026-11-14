// Members of global tables that a Lua file reads (`go.animate`, `math.huge`) and the ones it adds
// (`function math.clamp`, `require "table.new"`), for the unknown-API check (lua/apicheck.ts).
// Needs an AST from parseLua: its scope tracking marks identifiers that refer to locals, so `local camera = …`
// followed by `camera.follow()` is never mistaken for the built-in camera table.
import { firstArgString, walk, type Node } from './check.js';

export interface MemberUse {
  /** `root.member`, e.g. go.set_position. */
  name: string;
  root: string;
  line?: number;
  column?: number;
}

export interface GlobalScan {
  /** Reads and calls of `root.member` where root is a global. */
  uses: MemberUse[];
  /** `root.member` names the file creates. */
  defines: Set<string>;
  /**
   * Globals whose members cannot be known from the code: assigned (`camera = require "x"`), declared as a global
   * function, written with a computed key (`go[k] = v`) or handed around as a value (`local g = go`,
   * `setmetatable(sys, …)`, `if html5 then`).
   */
  open: Set<string>;
}

const MODULE_MEMBER = /^[A-Za-z_]\w*\.[A-Za-z_]\w*$/;

export function scanGlobals(ast: Node): GlobalScan {
  const out: GlobalScan = { uses: [], defines: new Set(), open: new Set() };
  walk(ast, [], (node, ancestors) => {
    if (node.type === 'CallExpression' || node.type === 'StringCallExpression') {
      // LuaJIT's optional table functions are loaded into their table: require "table.new" defines table.new.
      const base = node.base as Node;
      if (base.type === 'Identifier' && base.name === 'require' && !base.isLocal) {
        const module = firstArgString(node);
        if (module && MODULE_MEMBER.test(module)) out.defines.add(module);
      }
      return;
    }
    if (node.type !== 'Identifier' || node.isLocal) return;
    const parent = ancestors[ancestors.length - 1];
    if (!parent) return;
    // Field names (`x.y`), table keys (`{ y = 1 }`) and labels are Identifiers too, but not variables.
    if (parent.type === 'MemberExpression' && parent.identifier === node) return;
    if (parent.type === 'TableKeyString' && parent.key === node) return;
    if (parent.type === 'LabelStatement' || parent.type === 'GotoStatement') return;

    // Follow `root.a.b` outwards; stop at `:` (method call) and at computed keys.
    const chain = [node.name as string];
    let top: Node = node;
    let depth = ancestors.length - 1;
    while (depth >= 0) {
      const p = ancestors[depth]!;
      if (p.type !== 'MemberExpression' || p.base !== top || p.indexer !== '.') break;
      chain.push((p.identifier as Node).name as string);
      top = p;
      depth--;
    }
    const above = ancestors[depth];
    // `_G.go = …` rebinds go and `_G.math.clamp = …` defines math.clamp, like the forms without _G.
    const viaG = chain[0] === '_G';
    const names = viaG ? chain.slice(1) : chain;
    if (!names.length) return;

    if (names.length === 1) {
      // The global table itself rather than one of its members.
      if (above?.type === 'MemberExpression' && above.base === top) return; // go:method()
      if (above?.type === 'IndexExpression' && above.base === top) {
        if (isAssignmentTarget(above, ancestors[depth - 1])) out.open.add(names[0]!);
        return; // reading go[k] says nothing about go's members
      }
      out.open.add(names[0]!);
      return;
    }
    const name = `${names[0]}.${names[1]}`;
    // A member that is assigned, or tested for existence (`if sys.x then sys.x() end`, `table.unpack or unpack`),
    // may exist when the code that uses it runs.
    if (names.length === 2 && (isAssignmentTarget(top, above) || isExistenceTest(top, above))) out.defines.add(name);
    else if (!viaG) out.uses.push({ name, root: names[0]!, line: node.loc?.start.line, column: node.loc ? node.loc.start.column + 1 : undefined });
  });
  return out;
}

/** `expr` is checked rather than used: a condition, an operand of and/or/not, compared with nil, or passed to type(). */
function isExistenceTest(expr: Node, parent: Node | undefined): boolean {
  if (!parent) return false;
  switch (parent.type) {
    case 'LogicalExpression':
      return true;
    case 'UnaryExpression':
      return parent.operator === 'not';
    case 'IfClause':
    case 'ElseifClause':
    case 'WhileStatement':
    case 'RepeatStatement':
      return parent.condition === expr;
    case 'BinaryExpression': {
      const other = parent.left === expr ? (parent.right as Node) : (parent.left as Node);
      return (parent.operator === '==' || parent.operator === '~=') && other.type === 'NilLiteral';
    }
    case 'CallExpression': {
      const base = parent.base as Node;
      return base.type === 'Identifier' && base.name === 'type' && !base.isLocal;
    }
    default:
      return false;
  }
}

/** `expr` is written by its parent: `expr = …`, `function expr() … end`. */
function isAssignmentTarget(expr: Node, parent: Node | undefined): boolean {
  if (parent?.type === 'AssignmentStatement') return (parent.variables as Node[]).includes(expr);
  if (parent?.type === 'FunctionDeclaration') return parent.identifier === expr;
  return false;
}
