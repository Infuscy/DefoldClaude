import { defineTool } from './registry.js';
import { runInput } from './schemas.js';
import { notYet } from './_stub.js';

export const runTool = defineTool({
  name: 'run',
  title: 'Run Defold game',
  description:
    `Start, stop, restart or hot-reload the game, or send an engine command (toggle_physics_debug, toggle_profile, resize). start builds first, launches the engine (through the editor when open, else headless dmengine) and returns the first log lines plus any Lua errors seen within wait_seconds. reload pushes changed resources into the running game without restarting.`,
  inputSchema: runInput,
  annotations: { readOnlyHint: false },
  handler: notYet('M1'),
});
