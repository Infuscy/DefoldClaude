import { defineTool } from './registry.js';
import { screenshotInput } from './schemas.js';
import { notYet } from './_stub.js';

export const screenshotTool = defineTool({
  name: 'screenshot',
  title: 'Screenshot',
  description:
    `Return a PNG image. source=game captures the running game window (Windows; uses the Automation Bridge when present). source=preview renders a scene resource such as a .collection, .go or .gui through the open Defold editor without running the game.`,
  inputSchema: screenshotInput,
  annotations: { readOnlyHint: true },
  handler: notYet('M1'),
});
