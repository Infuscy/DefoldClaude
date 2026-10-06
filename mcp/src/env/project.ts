import fs from 'node:fs';
import path from 'node:path';
import { isDir, isFile, readTextSync } from '../util/fsx.js';
import { indexedValues, parseIni, type IniDocument } from '../util/ini.js';
import { usableEnv } from './platform.js';

export interface DefoldProject {
  root: string;
  gameProject: string;
  ini: IniDocument;
  title: string;
}

export class ProjectNotFoundError extends Error {}

const SKIP_DIRS = new Set(['node_modules', '.git', '.internal', 'build', '.svn', '.hg', '.idea', '.vscode']);

/**
 * Resolve the Defold project to operate on.
 * Order: explicit argument (dir or any file inside the project) → DEFOLD_PROJECT_DIR → working directory
 * (walking up) → a single game.project found in subdirectories (depth ≤ 3).
 */
export function resolveProject(explicit?: string): DefoldProject {
  const starts: string[] = [];
  if (explicit && explicit.trim()) starts.push(path.resolve(explicit.trim()));
  else {
    const env = process.env.DEFOLD_PROJECT_DIR;
    if (usableEnv(env)) starts.push(path.resolve(env));
    starts.push(process.cwd());
  }
  for (const start of starts) {
    const up = findUp(start);
    if (up) return loadProject(up);
  }
  for (const start of starts) {
    if (!isDir(start)) continue;
    const found = findDown(start, 3);
    if (found.length === 1) return loadProject(found[0]!);
    if (found.length > 1) {
      throw new ProjectNotFoundError(
        `Several Defold projects found under ${start}; pass "project" with one of:\n` + found.map((f) => `  ${f}`).join('\n'),
      );
    }
  }
  throw new ProjectNotFoundError(
    `No game.project found (searched ${starts.join(', ')} and parents/subfolders). Pass "project" as the folder containing game.project.`,
  );
}

export function tryResolveProject(explicit?: string): DefoldProject | undefined {
  try {
    return resolveProject(explicit);
  } catch {
    return undefined;
  }
}

/** Walk up from `start` (a dir or a file) looking for game.project. */
export function findUp(start: string): string | undefined {
  let dir = isDir(start) ? start : path.dirname(start);
  for (let i = 0; i < 64; i++) {
    if (isFile(path.join(dir, 'game.project'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

function findDown(root: string, depth: number): string[] {
  const out: string[] = [];
  const visit = (dir: string, d: number) => {
    if (isFile(path.join(dir, 'game.project'))) {
      out.push(dir);
      return;
    }
    if (d === 0) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) visit(path.join(dir, e.name), d - 1);
    }
  };
  visit(root, depth);
  return out;
}

export function loadProject(root: string): DefoldProject {
  const gameProject = path.join(root, 'game.project');
  const ini = parseIni(readTextSync(gameProject) ?? '');
  return { root, gameProject, ini, title: ini.get('project', 'title') ?? path.basename(root) };
}

export function projectDependencies(project: DefoldProject): string[] {
  return indexedValues(project.ini, 'project', 'dependencies');
}

/** Convert an absolute file path inside the project to a Defold resource path ("/main/x.script"). */
export function toResourcePath(project: DefoldProject, file: string): string | undefined {
  const rel = path.relative(project.root, path.resolve(file));
  if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return '/' + rel.split(path.sep).join('/');
}

/** Convert a Defold resource path ("/main/x.script", also accepts "main/x.script") to an absolute file path. */
export function fromResourcePath(project: DefoldProject, resource: string): string {
  const clean = resource.replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(project.root, clean);
  const rel = path.relative(project.root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the project: ${resource}`);
  }
  return abs;
}

/**
 * Accept a filesystem path (absolute, e.g. `C:\game\main\x.script`) or a Defold resource path
 * (`/main/x.script`, `main/x.script`) and return both forms.
 */
export function normalizeProjectPath(project: DefoldProject, p: string): { file: string; resource: string } {
  if (isFilesystemPath(project, p)) {
    const resource = toResourcePath(project, p);
    if (!resource) throw new Error(`File is outside the project ${project.root}: ${p}`);
    return { file: path.resolve(p), resource };
  }
  const file = fromResourcePath(project, p);
  return { file, resource: toResourcePath(project, file)! };
}

function isFilesystemPath(project: DefoldProject, p: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')) return true;
  // On POSIX a leading "/" is ambiguous: treat it as a filesystem path only if it points inside the project.
  if (process.platform !== 'win32' && p.startsWith('/')) {
    const root = project.root.endsWith(path.sep) ? project.root : project.root + path.sep;
    return p === project.root || p.startsWith(root);
  }
  return false;
}

/** Editor HTTP server files exist only while the project is open in the Defold editor. */
export function editorPortFiles(project: DefoldProject): { port?: number; token?: string } {
  const portText = readTextSync(path.join(project.root, '.internal', 'editor.port'));
  const token = readTextSync(path.join(project.root, '.internal', 'editor.token'))?.trim();
  const port = portText ? Number(portText.trim()) : undefined;
  return { port: port && Number.isFinite(port) ? port : undefined, token: token || undefined };
}
