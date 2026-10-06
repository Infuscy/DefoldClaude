import { defineTool } from './registry.js';
import { validateInput } from './schemas.js';
import { notYet } from './_stub.js';

export const validateTool = defineTool({
  name: 'validate',
  title: 'Validate Defold project',
  description:
    `Check files or the whole project without building: Lua syntax and common Defold mistakes, scene file schema (unknown fields, wrong enum values, missing required fields), missing resource references, duplicate ids, GUI texture/font/layer names, and game.project keys. Faster than a build; run after larger edits.`,
  inputSchema: validateInput,
  annotations: { readOnlyHint: true },
  handler: notYet('M3'),
});
