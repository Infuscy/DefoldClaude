// The tool contract. Names and input schemas are frozen here so skills, tests and evals can rely on them.
import * as z from 'zod/v4';

const project = z
  .string()
  .optional()
  .describe('Folder containing game.project (or any file inside the project). Defaults to the session project.');

export const statusInput = z.object({ project });

export const buildInput = z.object({
  project,
  command: z
    .enum(['build', 'resolve', 'clean', 'bundle'])
    .default('build')
    .describe('build = compile all resources and report issues; resolve = fetch library dependencies; clean = remove build output; bundle = create a platform bundle.'),
  backend: z
    .enum(['auto', 'editor', 'bob'])
    .default('auto')
    .describe('auto uses the open Defold editor when it has this project open, otherwise bob (headless).'),
  platform: z
    .string()
    .optional()
    .describe('Target platform for bundle (e.g. wasm-web, x86_64-win32, arm64-android, arm64-macos, x86_64-linux). Defaults to the host platform.'),
  variant: z.enum(['debug', 'release', 'headless']).default('debug'),
  bundle_output: z.string().optional().describe('Output folder for bundles (default <project>/bundle/<platform>).'),
  timeout_seconds: z.number().int().min(10).max(3600).default(900),
});

export const runInput = z.object({
  project,
  action: z
    .enum(['start', 'stop', 'restart', 'reload', 'command'])
    .default('start')
    .describe('start (builds first), stop, restart, reload = hot-reload changed resources into the running game, command = engine command.'),
  backend: z.enum(['auto', 'editor', 'bob']).default('auto'),
  wait_seconds: z
    .number()
    .min(0)
    .max(60)
    .default(3)
    .describe('After start/reload, collect logs for this long and report errors.'),
  command: z
    .enum(['toggle_physics_debug', 'toggle_profile', 'resize'])
    .optional()
    .describe('Engine command for action=command.'),
  width: z.number().int().positive().optional().describe('Window width for command=resize.'),
  height: z.number().int().positive().optional().describe('Window height for command=resize.'),
});

export const logsInput = z.object({
  project,
  cursor: z.number().int().min(0).optional().describe('Return only lines after this cursor (from a previous call).'),
  level: z.enum(['all', 'warning', 'error']).default('all'),
  grep: z.string().optional().describe('Case-insensitive substring or /regex/ filter.'),
  max_lines: z.number().int().min(1).max(1000).default(150),
});

export const screenshotInput = z.object({
  project,
  source: z
    .enum(['game', 'preview'])
    .default('game')
    .describe('game = the running game window; preview = editor-rendered image of a scene resource (editor must be open).'),
  path: z.string().optional().describe('Resource to preview for source=preview, e.g. /main/main.collection or /gui/hud.gui.'),
  max_size: z.number().int().min(128).max(2048).default(1024).describe('Longest side of the returned image in pixels.'),
});

export const inspectInput = z.object({
  project,
  filter: z.string().optional().describe('Only include nodes whose id, type or resource contains this text (case-insensitive).'),
  max_depth: z.number().int().min(1).max(64).default(12),
  max_nodes: z.number().int().min(1).max(2000).default(300),
  transforms: z.boolean().default(true).describe('Include positions/rotations/scales.'),
  elements: z
    .boolean()
    .default(false)
    .describe('List interactive elements with screen bounds (game objects, components and GUI nodes) via the Automation Bridge, for use with the input tool.'),
});

export const apiInput = z.object({
  project,
  name: z.string().optional().describe('Exact element to document, e.g. go.animate, msg.post, collision_response, sprite.play_flipbook.'),
  query: z.string().optional().describe('Free-text search, e.g. "raycast", "play animation on sprite", "screen to world".'),
  namespace: z.string().optional().describe('Restrict to a namespace, e.g. go, gui, vmath, physics, editor.'),
  environment: z.enum(['runtime', 'editor', 'all']).default('runtime').describe('runtime = game scripts; editor = editor scripts.'),
  limit: z.number().int().min(1).max(50).default(12),
});

export const docsInput = z.object({
  action: z.enum(['list', 'search', 'read']).default('search'),
  source: z.enum(['manuals', 'examples', 'all']).default('all'),
  query: z.string().optional().describe('Search text for action=search.'),
  name: z.string().optional().describe('Manual or example to read, e.g. "addressing", "physics-messages", "animation:easing".'),
  section: z.string().optional().describe('Only return the section whose heading contains this text.'),
  offset: z.number().int().min(0).default(0),
  max_chars: z.number().int().min(1000).max(40000).default(16000),
});

export const readResourceInput = z.object({
  project,
  path: z.string().describe('Resource path like /main/main.collection (library and /builtins/ paths work too) or an absolute file path.'),
  select: z
    .string()
    .optional()
    .describe('Return only this subtree, e.g. /embedded_instances[id=player] or /nodes[id=score].'),
  describe: z
    .boolean()
    .default(false)
    .describe('Return the schema (fields, types, defaults, enum values) for this resource type instead of its content.'),
  raw: z.boolean().default(false).describe('Return the file text unchanged.'),
  max_chars: z.number().int().min(1000).max(60000).default(20000),
});

const editOp = z.object({
  op: z.enum(['set', 'insert', 'remove']),
  path: z
    .string()
    .describe('Selector such as /embedded_instances[id=go]/position/x or /embedded_instances[id=go]/data/embedded_components[id=sprite]/data/default_animation. Insert targets a repeated field, e.g. /embedded_instances.'),
  value: z.unknown().optional().describe('JSON value for set/insert. Embedded `data` may be given as a JSON object; it is encoded for you.'),
  index: z.number().int().min(0).optional().describe('Insert position (default: append).'),
});

export const editResourceInput = z.object({
  project,
  path: z.string().describe('Resource to edit or create, e.g. /main/enemy.go.'),
  ops: z.array(editOp).default([]),
  create: z.boolean().default(false).describe('Create the file if missing (from the editor template for its type, then apply ops).'),
  dry_run: z.boolean().default(false).describe('Validate and show the diff without writing.'),
});

export const validateInput = z.object({
  project,
  paths: z.array(z.string()).optional().describe('Files or folders to check; default is the whole project.'),
  max_issues: z.number().int().min(1).max(500).default(100),
});

export const findReferencesInput = z.object({
  project,
  path: z
    .string()
    .describe('What to find uses of: a resource (/main/hero.atlas), a folder (/images/) or a Lua module (/modules/util.lua or its require name modules.util).'),
  max_results: z.number().int().min(1).max(2000).default(200),
});

export const newProjectInput = z.object({
  template: z
    .string()
    .default('empty')
    .describe('Template id: empty, mobile, desktop, basic-3d, platformer, html5-poki, native-extension, rive, or a tutorial/sample id from the list.'),
  directory: z.string().describe('Empty or non-existent folder to create the project in.'),
  title: z.string().optional().describe('Project title written to game.project.'),
});

export const inputInput = z.object({
  project,
  action: z.enum(['click', 'drag', 'key', 'text', 'wheel']).describe('click/tap, drag (to to_target or to_x/to_y), key presses, typed text, or mouse wheel.'),
  target: z
    .string()
    .optional()
    .describe('Element to act on: its visible text or name (e.g. "Play", "/player", "logo") or an element id from inspect. Alternative to x/y.'),
  x: z.number().optional().describe('Window x (pixels from the left, or a 0..1 fraction with normalized=true).'),
  y: z.number().optional().describe('Window y (pixels from the top, or a 0..1 fraction with normalized=true).'),
  normalized: z.boolean().default(false).describe('Treat x/y/to_x/to_y as fractions of the window, e.g. read off a screenshot.'),
  to_target: z.string().optional().describe('Drag destination element.'),
  to_x: z.number().optional(),
  to_y: z.number().optional(),
  keys: z.array(z.string()).optional().describe('Keys for action=key, e.g. ["KEY_SPACE"] or ["LEFT", "LEFT"].'),
  text: z.string().optional().describe('Text for action=text.'),
  hold: z.number().min(0).max(10).optional().describe('Seconds to hold the keys down.'),
  steps: z.number().int().min(-64).max(64).optional().describe('Wheel detents for action=wheel (+up, -down).'),
  duration: z.number().min(0).max(5).default(0.3).describe('Drag duration in seconds.'),
  wait_ms: z.number().int().min(0).max(10_000).default(400).describe('Wait after the input before reporting logs.'),
  screenshot: z.boolean().default(false).describe('Also return a screenshot taken after the input.'),
});
