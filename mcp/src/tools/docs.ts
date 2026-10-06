import { defineTool } from './registry.js';
import { docsInput } from './schemas.js';
import { notYet } from './_stub.js';

export const docsTool = defineTool({
  name: 'docs',
  title: 'Defold manuals and examples',
  description:
    `Search and read the official Defold manuals and examples (cached locally). action=list shows topics, search finds relevant sections, read returns a manual or example (optionally one section). Use for concepts and workflows; use the api tool for exact function signatures.`,
  inputSchema: docsInput,
  annotations: { readOnlyHint: true },
  handler: notYet('M2'),
});
