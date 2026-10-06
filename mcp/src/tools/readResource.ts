import { defineTool } from './registry.js';
import { readResourceInput } from './schemas.js';
import { notYet } from './_stub.js';

export const readResourceTool = defineTool({
  name: 'read_resource',
  title: 'Read Defold resource',
  description:
    `Read a Defold resource as structured JSON: .collection, .go, .gui, .atlas, .sprite, .particlefx, .tilemap, .input_binding and other protobuf-text files, with embedded game objects/components decoded from their escaped strings. Works for library dependency and /builtins/ paths. describe=true returns the field schema (types, defaults, enum values) for the resource type — use it before writing a new kind of resource.`,
  inputSchema: readResourceInput,
  annotations: { readOnlyHint: true },
  handler: notYet('M3'),
});
