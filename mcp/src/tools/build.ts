import { defineTool } from './registry.js';
import { buildInput } from './schemas.js';
import { notYet } from './_stub.js';

export const buildTool = defineTool({
  name: 'build',
  title: 'Build Defold project',
  description:
    `Build the Defold project and return structured issues {severity, resource, line, message}. Uses the open Defold editor when it has the project open (fast, same results as the editor), otherwise bob headless into build/agent. command=resolve fetches library dependencies, clean removes build output, bundle creates a platform bundle (platform e.g. wasm-web, x86_64-win32, arm64-android).`,
  inputSchema: buildInput,
  annotations: { readOnlyHint: false },
  handler: notYet('M1'),
});
