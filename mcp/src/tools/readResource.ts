import { messageToJson } from '../ddf/codec.js';
import { describeMessage } from '../ddf/describe.js';
import { selectJson } from '../ddf/edit.js';
import { messageForResource } from '../ddf/schema.js';
import { parseTextFormat } from '../ddf/textformat.js';
import { readBuiltin } from '../env/builtins.js';
import { locateDefold } from '../env/locate.js';
import { readResourceText } from '../env/projectfs.js';
import { normalizeProjectPath } from '../env/project.js';
import { requireProject } from './common.js';
import { defineTool } from './registry.js';
import { errorResult, pageText, textResult } from './result.js';
import { readResourceInput } from './schemas.js';

export const readResourceTool = defineTool({
  name: 'read_resource',
  title: 'Read Defold resource',
  description:
    `Read a Defold resource as structured JSON: .collection, .go, .gui, .atlas, .sprite, .particlefx, .tilemap, .input_binding and other protobuf-text files, with embedded game objects/components decoded from their escaped strings. Works for library dependency and /builtins/ paths. describe=true returns the field schema (types, defaults, enum values) for the resource type — use it before writing a new kind of resource.`,
  inputSchema: readResourceInput,
  annotations: { readOnlyHint: true },
  async handler(args) {
    const type = messageForResource(args.path);
    if (args.describe) {
      if (!type) return errorResult(`No schema for "${args.path}" (not a protobuf-text resource type). Lua files are plain text.`);
      const ext = args.path.slice(args.path.lastIndexOf('.'));
      return textResult(describeMessage(type, `${ext} file`));
    }
    const project = requireProject(args.project);
    const { resource } = normalizeProjectPath(project, args.path);
    const install = locateDefold().install;
    const { text, origin } = await readResourceText(project, resource, install ? (r) => readBuiltin(install, r) : undefined);
    const where = origin.kind === 'project' ? '' : origin.kind === 'library' ? ' (from a library dependency, read-only)' : ' (Defold builtin, read-only)';

    if (args.raw || !type) {
      const page = pageText(text, 0, args.max_chars);
      const note = !type && !args.raw ? ' (not a protobuf-text resource; returned as text)' : '';
      return textResult(`${resource}${where}${note}:\n${page.text}${page.nextOffset !== undefined ? '\n… [truncated]' : ''}`);
    }

    let json;
    try {
      json = args.select ? selectJson(text, type, args.select) : messageToJson(parseTextFormat(text).root, type);
    } catch (e) {
      return errorResult(`Could not read ${resource}: ${(e as Error).message}`);
    }
    const out = JSON.stringify(json, null, 1);
    const page = pageText(out, 0, args.max_chars);
    const hint = page.nextOffset !== undefined ? '\n… [truncated: narrow with select=/field[id=…]]' : '';
    return textResult(`${resource}${where} as ${type.split('.').pop()}${args.select ? ` → ${args.select}` : ''}:\n${page.text}${hint}`);
  },
});
