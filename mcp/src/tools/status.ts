import { describeInstall, locateDefold, unpackedEngine } from '../env/locate.js';
import { editorPortFiles, projectDependencies, tryResolveProject } from '../env/project.js';
import { hostPlatform } from '../env/platform.js';
import { defineTool } from './registry.js';
import { textResult } from './result.js';
import { statusInput } from './schemas.js';
import { runtimeSummary } from '../runtime/state.js';

export const statusTool = defineTool({
  name: 'status',
  title: 'Defold status',
  description:
    'Show the Defold installation (version, bob, engine), the current project (title, main collection, dependencies), whether the Defold editor has the project open, and whether a game is running. Call this first in a Defold session or when another tool reports a setup problem.',
  inputSchema: statusInput,
  annotations: { readOnlyHint: true },
  async handler(args) {
    const { install, searched } = locateDefold({ refresh: true });
    const lines: string[] = [];
    const structured: Record<string, unknown> = { host_platform: hostPlatform() };

    if (install) {
      lines.push(describeInstall(install));
      const engine = unpackedEngine(install);
      lines.push(`  engine:  ${engine ?? (install.jarPath ? 'will be extracted from the jar' : 'MISSING')}`);
      structured.install = {
        root: install.root,
        version: install.version,
        sha1: install.sha1,
        java: install.javaPath,
        jar: install.jarPath,
        editor: install.editorExe,
        unpack_dir: install.unpackDir,
        problems: install.problems,
      };
    } else {
      lines.push('Defold installation: NOT FOUND');
      lines.push('Set the plugin option "defold_path" (or env DEFOLD_HOME) to the folder containing Defold.exe/config.');
      lines.push('Checked:');
      for (const s of searched) lines.push(`  ${s}`);
      structured.install = null;
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
      structured.project = {
        root: project.root,
        title: project.title,
        dependencies: deps,
        editor_port: editor.port ?? null,
      };
    } else {
      lines.push('');
      lines.push('Project: none found (pass "project" = folder containing game.project).');
      structured.project = null;
    }

    const runtime = runtimeSummary();
    if (runtime) {
      lines.push('');
      lines.push(runtime.text);
      structured.runtime = runtime.data;
    }
    return textResult(lines.join('\n'), structured);
  },
});
