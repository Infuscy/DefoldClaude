import { defineTool } from './registry.js';
import { newProjectInput } from './schemas.js';
import { notYet } from './_stub.js';

export const newProjectTool = defineTool({
  name: 'new_project',
  title: 'New Defold project',
  description:
    `Create a new Defold project from an official template (empty, mobile, desktop, basic-3d, platformer, html5-poki, native-extension, rive, or a tutorial/sample) in an empty folder and set its title. The empty template works offline.`,
  inputSchema: newProjectInput,
  annotations: { readOnlyHint: false },
  handler: notYet('M5'),
});
