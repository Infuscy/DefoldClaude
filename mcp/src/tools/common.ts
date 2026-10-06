import fs from 'node:fs';
import { locateDefold, type DefoldInstall } from '../env/locate.js';
import { fromResourcePath, resolveProject, type DefoldProject } from '../env/project.js';
import { connectEditor, editorCommand, supportsBlockingCommands, type EditorBuildResult, type EditorConnection } from '../runtime/editor.js';

/**
 * Run a build-type editor command. Right after a file changes on disk the editor can still report
 * stale Lua diagnostics for the old content (its language server catches up asynchronously), so when
 * every error points at a file modified in the last few seconds we wait briefly and ask once more.
 */
export async function editorBuildCommand(
  project: DefoldProject,
  conn: EditorConnection,
  name: string,
  options: Parameters<typeof editorCommand>[2] = {},
): Promise<EditorBuildResult> {
  const first = await editorCommand(conn, name, options);
  if (first.success) return first;
  const errors = first.issues.filter((i) => i.severity === 'error');
  const now = Date.now();
  const allRecent =
    errors.length > 0 &&
    errors.every((i) => {
      if (!i.resource) return false;
      try {
        return now - fs.statSync(fromResourcePath(project, i.resource)).mtimeMs < 10_000;
      } catch {
        return false;
      }
    });
  if (!allRecent) return first;
  await new Promise((r) => setTimeout(r, 2000));
  return editorCommand(conn, name, options);
}

export function requireInstall(): DefoldInstall {
  const { install, searched } = locateDefold();
  if (!install) {
    throw new Error(
      'Defold installation not found. Set the plugin option "defold_path" (or env DEFOLD_HOME) to the folder containing the Defold editor.\nChecked:\n' +
        searched.map((s) => `  ${s}`).join('\n'),
    );
  }
  return install;
}

export function requireProject(arg?: string): DefoldProject {
  return resolveProject(arg);
}

export type Backend = { kind: 'editor'; conn: EditorConnection } | { kind: 'bob' };

/** Pick the build/run backend: the open editor when possible (and allowed), else headless bob. */
export async function chooseBackend(project: DefoldProject, requested: 'auto' | 'editor' | 'bob'): Promise<Backend> {
  if (requested === 'bob') return { kind: 'bob' };
  const conn = await connectEditor(project);
  if (conn && supportsBlockingCommands(conn)) return { kind: 'editor', conn };
  if (requested === 'editor') {
    throw new Error(
      conn
        ? 'The open Defold editor is older than 1.13.2 and lacks the blocking /command API; use backend=bob or update Defold.'
        : 'The Defold editor does not have this project open (no .internal/editor.port or it does not answer). Open the project in Defold or use backend=bob.',
    );
  }
  return { kind: 'bob' };
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
