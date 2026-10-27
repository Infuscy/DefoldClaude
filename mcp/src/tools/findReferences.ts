import fs from 'node:fs';
import { fileReferences, matches, type Reference, type Target } from '../ddf/references.js';
import { fromResourcePath, normalizeProjectPath, toResourcePath, type DefoldProject } from '../env/project.js';
import { modulePath, moduleName } from '../lua/refs.js';
import { isDir, isFile, walkFiles } from '../util/fsx.js';
import { PROJECT_SKIP_DIRS, plural, requireProject } from './common.js';
import { defineTool } from './registry.js';
import { textResult } from './result.js';
import { findReferencesInput } from './schemas.js';

const BINARY = /\.(png|jpe?g|tga|bmp|gif|webp|psd|ktx2?|basis|ico|icns|wav|ogg|opus|mp3|ttf|otf|glb|bin|zip|jar|dll|so|dylib|a|lib|exe)$/i;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export const findReferencesTool = defineTool({
  name: 'find_references',
  title: 'Find references to a Defold resource',
  description:
    `List every place in the project that refers to a resource, folder or Lua module: scene and component fields (also inside embedded game objects/components), game.project settings, require calls in dotted form (require "modules.util" → /modules/util.lua), resource path strings in Lua, and shader #include lines. Use it before renaming, moving or deleting a file, and update every reference it lists. Paths built at runtime (string concatenation) and references from library dependencies are not found.`,
  inputSchema: findReferencesInput,
  annotations: { readOnlyHint: true },
  async handler(args) {
    const project = requireProject(args.project);
    const target = resolveTarget(project, args.path.trim());
    const files = await walkFiles(project.root, PROJECT_SKIP_DIRS);

    const hits = new Map<string, Reference[]>();
    let scanned = 0;
    for (const file of files) {
      const resource = toResourcePath(project, file);
      if (!resource || BINARY.test(resource)) continue;
      let text: string;
      try {
        if (fs.statSync(file).size > MAX_FILE_BYTES) continue;
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (text.includes('\0')) continue;
      scanned++;
      const found = fileReferences(resource, text, target).filter((r) => matches(r, target));
      if (found.length) hits.set(resource, found.sort((a, b) => a.line - b.line));
    }

    const module = target.folder ? undefined : moduleName(target.path);
    const what = `${target.path}${target.folder ? '/ (folder)' : ''}${module ? ` (require "${module}")` : ''}`;
    const total = [...hits.values()].reduce((n, refs) => n + refs.length, 0);
    const exists = target.folder ? isDir(fromResourcePath(project, target.path)) : isFile(fromResourcePath(project, target.path));
    const missing = exists || target.path.startsWith('/builtins/') ? '' : `Note: ${target.path} does not exist in the project.`;
    if (!total) return textResult(`No references to ${what} in ${plural(scanned, 'file')}.${missing ? '\n' + missing : ''}`);

    const lines = [`${plural(total, 'reference')} to ${what} in ${plural(hits.size, 'file')}:`];
    let shown = 0;
    for (const resource of [...hits.keys()].sort()) {
      if (shown >= args.max_results) break;
      lines.push(resource);
      for (const r of hits.get(resource)!) {
        if (shown++ >= args.max_results) break;
        lines.push(`  ${r.line}: ${r.via}${target.folder && r.path !== target.path ? ` → ${r.path}` : ''}`);
      }
    }
    if (missing) lines.push(missing);
    if (total > args.max_results) lines.push(`… ${total - args.max_results} more (raise max_results or search a narrower path)`);
    return textResult(lines.join('\n'));
  },
});

/** Accept a resource or file path, a folder (trailing slash or existing directory) or a dotted module name. */
export function resolveTarget(project: DefoldProject, p: string): Target {
  if (!/[\\/]/.test(p) && !fs.existsSync(fromResourcePath(project, p))) return { path: modulePath(p), folder: false };
  const { file, resource } = normalizeProjectPath(project, p);
  const folder = /[\\/]$/.test(p) || isDir(file);
  const clean = resource.replace(/\/+$/, '');
  if (!clean) throw new Error('Give a file, folder or module inside the project, not the project root.');
  return { path: clean, folder };
}
