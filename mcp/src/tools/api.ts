import { defineTool } from './registry.js';
import { apiInput } from './schemas.js';
import { notYet } from './_stub.js';

export const apiTool = defineTool({
  name: 'api',
  title: 'Defold API reference',
  description:
    `Look up the Lua API of the installed Defold version: functions, messages, properties and constants for go, msg, gui, vmath, physics, sprite, factory, sys, render, sound, timer, editor (editor scripts) and more, plus APIs of native extensions used by the project. name=go.animate returns the full signature, parameters, return values and examples; query searches.`,
  inputSchema: apiInput,
  annotations: { readOnlyHint: true },
  handler: notYet('M2'),
});
