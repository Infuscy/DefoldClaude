// Lua syntax checking (luaparse, LuaJIT/5.1 grammar) and high-confidence Defold-specific lints.
// Every lint names the engine behaviour it relies on, so warnings stay trustworthy.
import luaparse from 'luaparse';
import type { Issue } from '../runtime/issues.js';

export interface LuaCheckOptions {
  /** Include lower-confidence style warnings (used by the validate tool, not by the edit hook). */
  thorough?: boolean;
}

const LIFECYCLE = ['init', 'final', 'update', 'fixed_update', 'late_update', 'on_message', 'on_input', 'on_reload'];
const GUI_LIFECYCLE = ['init', 'final', 'update', 'on_message', 'on_input', 'on_reload'];
const RENDER_LIFECYCLE = ['init', 'update', 'on_message', 'on_reload'];

export type Node = { type: string; [key: string]: unknown; loc?: { start: { line: number; column: number } } };

export function checkLua(code: string, resource: string, options: LuaCheckOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const ext = resource.slice(resource.lastIndexOf('.') + 1);
  let ast: Node;
  try {
    ast = luaparse.parse(code, { luaVersion: ext === 'editor_script' ? '5.2' : 'LuaJIT', locations: true, comments: false, scope: false }) as unknown as Node;
  } catch (e) {
    const err = e as { message: string; line?: number; column?: number };
    const message = err.message.replace(/^\[\d+:\d+\]\s*/, '');
    return [{ severity: 'error', resource, line: err.line, column: err.column !== undefined ? err.column + 1 : undefined, message: `Lua syntax error: ${message}`, rule: 'lua-syntax' }];
  }
  const add = (severity: Issue['severity'], node: Node | undefined, message: string, rule: string) =>
    issues.push({ severity, resource, line: node?.loc?.start.line, column: node?.loc ? node.loc.start.column + 1 : undefined, message, rule });

  const lifecycle = ext === 'gui_script' ? GUI_LIFECYCLE : ext === 'render_script' ? RENDER_LIFECYCLE : ext === 'script' ? LIFECYCLE : [];

  walk(ast, [], (node, ancestors) => {
    // 1. message_id / action_id compared with a string literal: they are hashes, so the comparison is never true.
    if (node.type === 'BinaryExpression' && (node.operator === '==' || node.operator === '~=')) {
      const l = node.left as Node;
      const r = node.right as Node;
      const id = l.type === 'Identifier' ? l : r.type === 'Identifier' ? r : undefined;
      const str = l.type === 'StringLiteral' ? l : r.type === 'StringLiteral' ? r : undefined;
      if (id && str && ['message_id', 'action_id'].includes(id.name as string)) {
        const lit = stringValue(str);
        add('warning', node, `${id.name} is a hash, so comparing it with the string "${lit}" is never true; use hash("${lit}")`, 'hash-compare');
      }
    }
    // 2. Lifecycle functions with a misspelled name are never called by the engine.
    if (lifecycle.length && node.type === 'FunctionDeclaration' && ancestors.length === 1 && !node.isLocal) {
      const ident = node.identifier as Node | null;
      if (ident?.type === 'Identifier') {
        const name = ident.name as string;
        if (!lifecycle.includes(name)) {
          const near = lifecycle.find((lc) => lc.toLowerCase() === name.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()).replace(/^_/, '') || distance(lc, name.toLowerCase()) <= 2);
          if (near) add('warning', ident, `"${name}" looks like the lifecycle function "${near}", but the engine only calls the exact name`, 'lifecycle-name');
        }
      }
    }
    if (node.type === 'CallExpression' || node.type === 'StringCallExpression' || node.type === 'TableCallExpression') {
      const callee = node.base as Node;
      const name = memberName(callee);
      // 3. go.property must run at the top level of the script while it is loaded.
      if (name === 'go.property' && ancestors.some((a) => a.type === 'FunctionDeclaration')) {
        add('error', node, 'go.property() must be called at the top level of the script, not inside a function', 'go-property-scope');
      }
      // 4. APIs that do not exist in this script type.
      if (name && ext === 'gui_script' && /^go\./.test(name) && name !== 'go.property') {
        add('warning', node, `${name} is not available in GUI scripts (gui_script); send a message to a game object script instead`, 'wrong-script-api');
      }
      if (name && ext === 'script' && /^gui\./.test(name)) {
        add('warning', node, `${name} only works in .gui_script files; send a message to the GUI script instead`, 'wrong-script-api');
      }
      if (name && ext === 'render_script' && /^(go|gui)\./.test(name)) {
        add('warning', node, `${name} is not available in render scripts`, 'wrong-script-api');
      }
      // 5. require paths use dots relative to the project root, without the .lua extension.
      if (name === 'require') {
        const arg = firstArgString(node);
        if (arg && (/[\\/]/.test(arg) || /\.lua$/.test(arg))) {
          const fixed = arg.replace(/\.lua$/, '').replace(/^[\\/]+/, '').replace(/[\\/]/g, '.');
          add('warning', node, `require "${arg}": use dotted module paths from the project root, e.g. require "${fixed}"`, 'require-path');
        }
      }
    }
    // (thorough) goto/labels are not available on HTML5, which runs plain Lua 5.1.
    if (options.thorough && node.type === 'GotoStatement') {
      add('info', node, 'goto is not available on HTML5 builds (plain Lua 5.1)', 'html5-compat');
    }
    // 6. (thorough) assignments to undeclared globals leak into every script (one shared Lua state; on 1.13 only with [script] shared_state).
    if (options.thorough && node.type === 'AssignmentStatement') {
      for (const v of node.variables as Node[]) {
        if (v.type === 'Identifier' && !(v as { isLocal?: boolean }).isLocal && /^[a-z]/.test(v.name as string) && !isLocalDeclared(v.name as string, ancestors)) {
          add('info', v, `"${v.name}" is assigned without "local" and becomes a global shared by all scripts`, 'global-assignment');
        }
      }
    }
  });

  return issues;
}

export function walk(node: Node, ancestors: Node[], visit: (n: Node, ancestors: Node[]) => void): void {
  visit(node, ancestors);
  const next = [...ancestors, node];
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c === 'object' && 'type' in c) walk(c as Node, next, visit);
    } else if (v && typeof v === 'object' && 'type' in (v as object)) {
      walk(v as Node, next, visit);
    }
  }
}

export function memberName(n: Node | undefined): string | undefined {
  if (!n) return undefined;
  if (n.type === 'Identifier') return n.name as string;
  if (n.type === 'MemberExpression') {
    const base = memberName(n.base as Node);
    const id = n.identifier as Node;
    return base ? `${base}${n.indexer}${id.name as string}` : undefined;
  }
  return undefined;
}

export function stringValue(n: Node): string {
  const raw = (n.raw as string | undefined) ?? '';
  if (n.value !== null && n.value !== undefined) return String(n.value);
  return raw.replace(/^(["'])(.*)\1$/s, '$2').replace(/^\[=*\[(.*)\]=*\]$/s, '$1');
}

export function firstArgString(call: Node): string | undefined {
  if (call.type === 'StringCallExpression') return stringValue(call.argument as Node);
  const args = call.arguments as Node[] | undefined;
  const first = args?.[0];
  return first?.type === 'StringLiteral' ? stringValue(first) : undefined;
}

function isLocalDeclared(name: string, ancestors: Node[]): boolean {
  for (const a of ancestors) {
    const body = (a.body as Node[] | undefined) ?? [];
    if (!Array.isArray(body)) continue;
    for (const st of body) {
      if (st.type === 'LocalStatement' && (st.variables as Node[]).some((v) => v.name === name)) return true;
      if (st.type === 'LocalFunctionDeclaration' && (st.identifier as Node)?.name === name) return true;
    }
    if (a.type === 'FunctionDeclaration' && (a.parameters as Node[]).some((p) => p.name === name)) return true;
    if ((a.type === 'ForNumericStatement' && (a.variable as Node).name === name) || (a.type === 'ForGenericStatement' && (a.variables as Node[]).some((v) => v.name === name))) return true;
  }
  return false;
}

function distance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}
