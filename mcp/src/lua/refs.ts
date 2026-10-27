// Resource references in Lua code: require'd modules and string literals holding resource paths.
import luaparse from 'luaparse';
import { firstArgString, memberName, stringValue, walk, type Node } from './check.js';

export interface LuaReference {
  /** Resource path: /a/b.lua for require "a.b", the literal itself for "/x.atlas". */
  path: string;
  line: number;
  kind: 'require' | 'string';
  /** The text as written: the module name for require, the literal otherwise. */
  text: string;
}

/** Resource path of a module name as passed to require ("a.b" → /a/b.lua). Tolerates the slash form. */
export function modulePath(name: string): string {
  return '/' + name.replace(/\.lua$/, '').replace(/^[\\/]+/, '').replace(/[\\/.]/g, '/') + '.lua';
}

/** Dotted module name of a Lua module resource (/a/b.lua → a.b), or undefined for other files. */
export function moduleName(resource: string): string | undefined {
  return resource.endsWith('.lua') ? resource.slice(1, -4).replace(/\//g, '.') : undefined;
}

// A literal that names a file: absolute, with an extension, no URL fragment ("/player#script" is an object URL).
const PATH_LITERAL = /^\/[^#:"'\r\n]*\.[A-Za-z0-9_]+$/;

/** All references in a Lua file, or undefined when it does not parse. */
export function luaReferences(code: string, resource: string): LuaReference[] | undefined {
  let ast: Node;
  try {
    ast = luaparse.parse(code, { luaVersion: resource.endsWith('.editor_script') ? '5.2' : 'LuaJIT', locations: true, comments: false, scope: false }) as unknown as Node;
  } catch {
    return undefined;
  }
  const refs: LuaReference[] = [];
  const requireArgs = new Set<Node>();
  walk(ast, [], (node) => {
    if ((node.type === 'CallExpression' || node.type === 'StringCallExpression') && memberName(node.base as Node) === 'require') {
      const name = firstArgString(node);
      if (name) {
        const arg = node.type === 'StringCallExpression' ? (node.argument as Node) : (node.arguments as Node[])[0]!;
        requireArgs.add(arg);
        refs.push({ path: modulePath(name), line: node.loc?.start.line ?? 0, kind: 'require', text: name });
      }
    } else if (node.type === 'StringLiteral' && !requireArgs.has(node)) {
      const value = stringValue(node);
      if (PATH_LITERAL.test(value)) refs.push({ path: value, line: node.loc?.start.line ?? 0, kind: 'string', text: value });
    }
  });
  return refs;
}
