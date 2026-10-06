import { defineTool } from './registry.js';
import { editResourceInput } from './schemas.js';
import { notYet } from './_stub.js';

export const editResourceTool = defineTool({
  name: 'edit_resource',
  title: 'Edit Defold resource',
  description:
    `Safely edit (or create) a protobuf-text resource such as .collection, .go, .gui or .atlas using set/insert/remove operations on selectors like /embedded_instances[id=player]/position/x. Handles the nested escaping of embedded game objects and components, validates against the Defold schema before writing, keeps untouched text unchanged and returns a diff. Prefer this over hand-editing embedded data strings.`,
  inputSchema: editResourceInput,
  annotations: { readOnlyHint: false },
  handler: notYet('M4'),
});
