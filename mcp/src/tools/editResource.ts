import fs from 'node:fs';
import { checkFile } from '../ddf/checkfile.js';
import { EncodeError } from '../ddf/codec.js';
import { applyEdits, SelectorError, type EditOp } from '../ddf/edit.js';
import { messageForResource } from '../ddf/schema.js';
import { TextFormatError } from '../ddf/textformat.js';
import { locateDefold } from '../env/locate.js';
import { editorPortFiles, normalizeProjectPath } from '../env/project.js';
import { loadLibraries, makeResourceChecker } from '../env/projectfs.js';
import { editorTemplate } from '../env/templates.js';
import { formatIssue, type Issue } from '../runtime/issues.js';
import { lineDiff } from '../util/diff.js';
import { writeFileAtomic } from '../util/fsx.js';
import { requireProject } from './common.js';
import { defineTool } from './registry.js';
import { errorResult, textResult } from './result.js';
import { editResourceInput } from './schemas.js';

export const editResourceTool = defineTool({
  name: 'edit_resource',
  title: 'Edit Defold resource',
  description:
    `Safely edit (or create) a protobuf-text resource such as .collection, .go, .gui or .atlas using set/insert/remove operations on selectors like /embedded_instances[id=player]/position/x. Handles the nested escaping of embedded game objects and components, validates against the Defold schema before writing, keeps untouched text unchanged and returns a diff. Prefer this over hand-editing embedded data strings. Build nested content in small steps rather than one deeply nested value: ops apply in order and missing data/position fields are created, e.g. insert {"id":"enemy"} into /embedded_instances, then insert the sprite into /embedded_instances[id=enemy]/data/embedded_components. If a call is rejected as invalid JSON, split it instead of resending it.`,
  inputSchema: editResourceInput,
  annotations: { readOnlyHint: false },
  async handler(args) {
    const project = requireProject(args.project);
    const { file, resource } = normalizeProjectPath(project, args.path);
    const type = messageForResource(resource);
    if (!type) return errorResult(`${resource} is not a protobuf-text resource (edit Lua and game.project as plain text).`);
    const install = locateDefold().install;

    let original: string | undefined;
    let created = false;
    if (fs.existsSync(file)) original = fs.readFileSync(file, 'utf8');
    else if (args.create) {
      original = (await editorTemplate(install, resource)) ?? '';
      created = true;
    } else {
      return errorResult(`${resource} does not exist. Pass create=true to create it (starting from the editor's template).`);
    }

    const crlf = original.includes('\r\n');
    const base = crlf ? original.replace(/\r\n/g, '\n') : original;
    let next: string;
    try {
      next = applyEdits(base, type, args.ops as EditOp[]);
    } catch (e) {
      if (e instanceof SelectorError || e instanceof EncodeError || e instanceof TextFormatError) return errorResult(`Edit not applied: ${e.message}`);
      throw e;
    }

    // Only block on errors this edit introduced; report pre-existing ones separately.
    const exists = makeResourceChecker(project, await loadLibraries(project));
    const opts = { resourceExists: exists, missingRefSeverity: 'warning' as const, installedVersion: install?.version };
    const key = (i: Issue) => `${i.rule}|${i.message}`;
    const before = created ? new Set<string>() : new Set(checkFile(resource, base, opts).filter((i) => i.severity === 'error').map(key));
    const after = checkFile(resource, next, opts);
    const newErrors = after.filter((i) => i.severity === 'error' && !before.has(key(i)));
    const warnings = after.filter((i) => i.severity === 'warning');
    const diff = lineDiff(created ? '' : base, next);

    if (newErrors.length) {
      return errorResult(
        `Edit NOT written: it would introduce ${newErrors.length} error(s):\n${newErrors.map((i) => `- ${formatIssue(i)}`).join('\n')}\n\nProposed change:\n${diff}`,
      );
    }
    const output = crlf ? next.replace(/\n/g, '\r\n') : next;
    if (!args.dry_run) await writeFileAtomic(file, output);
    const editorNote = editorPortFiles(project).port ? '\nThe Defold editor has this project open; it reloads the file on its next sync (build/run through the tools sync it).' : '';
    const warnText = warnings.length ? `\nWarnings:\n${warnings.map((i) => `- ${formatIssue(i)}`).join('\n')}` : '';
    const verb = args.dry_run ? 'Dry run (not written)' : created ? 'Created' : 'Updated';
    return textResult(`${verb} ${resource}.${warnText}\n${diff}${editorNote}`);
  },
});
