import { downloadDefold, downloadsRoot } from '../env/download.js';
import { findJava, javaMajor, javaProblem } from '../env/java.js';
import { describeInstall, locateDefold, unpackedEngine } from '../env/locate.js';
import { editorPortFiles, projectDependencies, tryResolveProject } from '../env/project.js';
import { defineTool } from './registry.js';
import { textResult } from './result.js';
import { statusInput } from './schemas.js';
import { runtimeSummary } from '../runtime/state.js';

export const statusTool = defineTool({
  name: 'status',
  title: 'Defold status',
  description:
    'Show the Defold installation (version, bob, engine), the current project (title, main collection, dependencies), whether the Defold editor has the project open, and whether a game is running. Call this first in a Defold session or when another tool reports a setup problem. Without a Defold editor, download="stable" (or a version) fetches bob.jar and the API docs so build, run and api work headless.',
  inputSchema: statusInput,
  // Not read-only: download writes ~250 MB into the plugin cache.
  annotations: { readOnlyHint: false },
  async handler(args, ctx) {
    let { install, searched } = locateDefold({ refresh: true });
    const lines: string[] = [];

    if (args.download) {
      if (install && install.source !== 'download') {
        lines.push(`Nothing downloaded: Defold ${install.version ?? ''} is already installed (${install.root}), and the tools use it.`, '');
      } else {
        const { download, cached } = await downloadDefold(args.download, { signal: ctx.signal, onProgress: (m, p) => void ctx.progress(m, p, 100) });
        lines.push(`${cached ? 'Already downloaded' : 'Downloaded'} Defold ${download.version} (sha1 ${download.sha1}) to ${download.dir}.`, '');
        ({ install, searched } = locateDefold({ refresh: true }));
      }
    }

    if (install) {
      lines.push(describeInstall(install));
      const engine = unpackedEngine(install);
      lines.push(`  engine:  ${engine ?? (install.jarPath ? 'will be extracted from the jar' : 'MISSING')}`);
      if (install.source === 'download' || install.source === 'bob-jar') {
        if (install.javaPath) lines.push(`  java version: ${javaMajor(install.javaPath) ?? '?'}`);
        const problem = await javaProblem(install.javaPath, install.jarPath, install.version);
        if (problem) lines.push(`  problem: ${problem} Until then build and run fail; api, docs, read_resource, edit_resource and validate work.`);
      }
    } else {
      const java = findJava();
      lines.push('Defold installation: NOT FOUND');
      lines.push('Set the plugin option "defold_path" (or env DEFOLD_HOME) to the folder containing Defold.exe/config.');
      lines.push(
        `Without the Defold editor: call status with download="stable" (or a release such as 1.13.2) to fetch bob.jar and the API docs ` +
          `(about 250 MB) into ${downloadsRoot()}. Ask the user first. Builds then need Java 25 for Defold 1.13+ ` +
          `(found: ${java ? `${java}, Java ${javaMajor(java) ?? '?'}` : 'none'}).`,
      );
      lines.push('Checked:');
      for (const s of searched) lines.push(`  ${s}`);
    }

    const project = tryResolveProject(args.project);
    if (project) {
      const deps = projectDependencies(project);
      const editor = editorPortFiles(project);
      lines.push('');
      lines.push(`Project: ${project.title}`);
      lines.push(`  root:            ${project.root}`);
      lines.push(`  main collection: ${project.ini.get('bootstrap', 'main_collection') ?? '(default)'}`);
      lines.push(`  display:         ${project.ini.get('display', 'width') ?? '960'}x${project.ini.get('display', 'height') ?? '640'}`);
      lines.push(`  dependencies:    ${deps.length ? deps.join(', ') : 'none'}`);
      lines.push(
        `  editor:          ${editor.port ? `open (HTTP port ${editor.port}) — builds/runs go through the editor; ask the user to save unsaved editor changes before editing files` : 'not open for this project (headless bob/dmengine will be used)'}`,
      );
    } else {
      lines.push('');
      lines.push('Project: none found (pass "project" = folder containing game.project).');
    }

    const runtime = runtimeSummary();
    if (runtime) {
      lines.push('');
      lines.push(runtime.text);
    }
    return textResult(lines.join('\n'));
  },
});
