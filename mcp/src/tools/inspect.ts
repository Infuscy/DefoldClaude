import { defineTool } from './registry.js';
import { inspectInput } from './schemas.js';
import { notYet } from './_stub.js';

export const inspectTool = defineTool({
  name: 'inspect',
  title: 'Inspect running game',
  description:
    `Return the live scene graph of the running game: collections, game objects (ids, world positions, scale, rotation) and components (type, resource). Use it to check that objects were spawned, where they are, and which components they have.`,
  inputSchema: inspectInput,
  annotations: { readOnlyHint: true },
  handler: notYet('M1'),
});
