// The members of Defold's global API tables (go, gui, vmath, sys, math, table, …) in the installed version, for the
// unknown-API check. Built from the same API reference as the api tool, so it follows the installed Defold.
import type { DefoldInstall } from '../env/locate.js';
import type { DefoldProject } from '../env/project.js';
import { enumMembers, loadApiIndex, loadProjectApis, type ApiElement } from './apiIndex.js';

export interface ApiNames {
  version?: string;
  /** Global tables whose members are checked. */
  roots: Set<string>;
  /** Every `root.member` that exists (nested tables such as b2d.body count as members of their root). */
  known: Set<string>;
  /** Member names per root, for suggestions. */
  members: Map<string, string[]>;
  /** Global functions such as unpack and pprint, for `table.unpack` style mistakes. */
  globals: Set<string>;
}

/**
 * Members the engine has that the API reference leaves out (compared with what the 1.14.1 engine holds in script,
 * GUI script and render script contexts): Lua 5.1 and LuaJIT extras, a few legacy constants, and the hook the
 * editor's debugger (/builtins/scripts/debugger.lua) installs through.
 */
const UNDOCUMENTED = [
  'sys.set_debugger_lightweight_hook',
  'coroutine.isyieldable',
  'debug.upvalueid',
  'debug.upvaluejoin',
  'io.stdin',
  'io.stdout',
  'io.stderr',
  'math.mod',
  'package.config',
  'package.searchpath',
  'gui.EASING_NONE',
  'gui.EASING_IN',
  'gui.EASING_OUT',
  'gui.EASING_INOUT',
  'liveupdate.LIVEUPDATE_NOT_INITIALIZED',
];

/** Element types that are values in a table at runtime; structs, typedefs, messages and properties only describe data. */
const TABLE_MEMBERS = new Set(['FUNCTION', 'CONSTANT', 'VARIABLE', 'ENUM']);
const DOTTED = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)+$/;

/**
 * Names of the runtime API. A table that a native extension of the project documents (a .script_api file) is not
 * checked: the extension may add members the reference does not list.
 */
export function apiNames(elements: ApiElement[], extensionElements: ApiElement[] = [], version?: string): ApiNames {
  const runtime = elements.filter((e) => e.environment === 'runtime');
  const names: ApiNames = { version, roots: new Set(), known: new Set(), members: new Map(), globals: new Set() };
  const add = (root: string, member: string) => {
    const name = `${root}.${member}`;
    if (names.known.has(name)) return;
    names.known.add(name);
    const list = names.members.get(root) ?? [];
    list.push(member);
    names.members.set(root, list);
  };
  for (const e of [...runtime, ...enumMembers(runtime)]) {
    if (!DOTTED.test(e.name)) {
      if (e.type === 'FUNCTION' && /^[A-Za-z_]\w*$/.test(e.name)) names.globals.add(e.name);
      continue;
    }
    const [root, member] = e.name.split('.') as [string, string];
    add(root, member);
    if (TABLE_MEMBERS.has(e.type)) names.roots.add(root);
  }
  for (const name of UNDOCUMENTED) {
    const [root, member] = name.split('.') as [string, string];
    add(root, member);
  }
  for (const e of extensionElements) names.roots.delete(e.name.split(/[.:]/)[0]!);
  for (const list of names.members.values()) list.sort();
  return names;
}

/** API names of the installed Defold plus the project's extension APIs (both loaders cache). Rejects when the reference cannot be read. */
export async function loadApiNames(install: DefoldInstall, project: DefoldProject): Promise<ApiNames> {
  const [elements, ext] = await Promise.all([loadApiIndex(install), loadProjectApis(project)]);
  return apiNames(elements, ext, install.version);
}
