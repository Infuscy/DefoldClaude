// Reads and calls of members that Defold's API tables do not have: go.set_visible, sprite.play_animation,
// table.unpack. They build fine and fail only when the line runs ("attempt to call field 'set_visible' (a nil value)").
// Members the project adds itself (function math.clamp, require "table.new"), tables it rebinds or hands around and
// tables a native extension documents are left alone.
import { closest } from '../ddf/codec.js';
import type { ApiNames } from '../docs/apiNames.js';
import type { Issue } from '../runtime/issues.js';
import { tryParseLua } from './check.js';
import { scanGlobals, type GlobalScan, type MemberUse } from './globals.js';

export interface ApiCheckSources {
  /** Names of the installed Defold's API; undefined skips the check. Asked for only when a file uses a global table. */
  names(): Promise<ApiNames | undefined>;
  /** Scans of the Lua files that are not checked themselves (rest of the project, libraries); asked for only when needed. */
  others(): Promise<GlobalScan[]>;
}

/** Editor scripts run inside the editor, whose API is a different one. */
export function isGameLua(resource: string): boolean {
  return !resource.endsWith('.editor_script');
}

export function scanLuaText(text: string, resource: string): GlobalScan | undefined {
  const ast = tryParseLua(text, resource);
  return ast && scanGlobals(ast);
}

export async function unknownApiIssues(checked: Map<string, GlobalScan>, sources: ApiCheckSources): Promise<Issue[]> {
  const files = [...checked].filter(([resource]) => isGameLua(resource));
  if (!files.some(([, scan]) => scan.uses.length)) return [];
  const names = await sources.names();
  if (!names) return [];

  const defined = new Set<string>();
  const open = new Set<string>();
  const learn = (scan: GlobalScan) => {
    for (const d of scan.defines) defined.add(d);
    for (const o of scan.open) open.add(o);
  };
  const unknown = (u: MemberUse) => names.roots.has(u.root) && !names.known.has(u.name) && !defined.has(u.name) && !open.has(u.root);
  for (const [, scan] of files) learn(scan);
  if (!files.some(([, scan]) => scan.uses.some(unknown))) return [];
  // Another file may add the member (a utility module with `function math.clamp`), so look at the rest first.
  for (const scan of await sources.others()) learn(scan);

  const version = names.version ? `Defold ${names.version}` : 'the installed Defold';
  const issues: Issue[] = [];
  for (const [resource, scan] of files) {
    for (const u of scan.uses) {
      if (!unknown(u)) continue;
      const member = u.name.slice(u.root.length + 1);
      issues.push({
        severity: 'warning',
        resource,
        line: u.line,
        column: u.column,
        message: `${u.name} does not exist in ${version} and nothing in the project defines it, so it is nil at runtime${hint(names, u.root, member)}`,
        rule: 'unknown-api',
      });
    }
  }
  return issues;
}

function hint(names: ApiNames, root: string, member: string): string {
  if (names.globals.has(member)) return ` — did you mean the global ${member}?`;
  const members = names.members.get(root) ?? [];
  const near = closest(member, members);
  if (near) return ` — did you mean ${root}.${near}?`;
  // Shared words: sprite.play_animation → sprite.play_flipbook.
  const words = member.toLowerCase().split('_').filter((w) => w.length >= 4);
  const similar = members.filter((m) => words.some((w) => m.toLowerCase().includes(w))).slice(0, 3);
  if (similar.length) return ` (similar: ${similar.map((m) => `${root}.${m}`).join(', ')})`;
  return ` (the api tool lists what exists: namespace=${root})`;
}
