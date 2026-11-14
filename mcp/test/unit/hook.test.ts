import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCHEMA_DEFOLD_VERSION } from '../../src/ddf/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const hook = path.resolve(here, '../../../plugins/defold/dist/hook.mjs');
let root: string;
let installs: string;
let cache: string;

/** A folder that passes for a Defold install of `version`; the hook only reads the version from its config. */
function fakeInstall(version: string): string {
  const dir = path.join(installs, version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config'), `[build]\nversion = ${version}\n`);
  return dir;
}

function runHook(event: string, input: object, env: Record<string, string> = {}) {
  const started = Date.now();
  // The "installed" Defold is pinned to the schema's version, so results do not depend on this machine's Defold.
  const r = spawnSync(process.execPath, [hook, event], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, DEFOLD_HOME: fakeInstall(SCHEMA_DEFOLD_VERSION), DEFOLD_CACHE_DIR: cache, ...env },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - started };
}

function write(rel: string, text: string): string {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
}

beforeAll(() => {
  installs = fs.mkdtempSync(path.join(os.tmpdir(), 'defold installs '));
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'defold hook '));
  // A small API reference where the hook looks for the cached one (a fake install has no sha1: key "unknown").
  cache = fs.mkdtempSync(path.join(os.tmpdir(), 'defold cache '));
  const element = (name: string) => ({ name, type: 'FUNCTION', namespace: name.split('.')[0], brief: '', description: '', params: [], returns: [], examples: '', members: [], environment: 'runtime', source: 'test' });
  fs.mkdirSync(path.join(cache, 'api'));
  fs.writeFileSync(path.join(cache, 'api', 'unknown.v3.json'), JSON.stringify(['go.animate', 'go.set_position', 'table.insert', 'unpack'].map(element)));
  write('game.project','[project]\ntitle = Hook Test\n\n[bootstrap]\nmain_collection = /main/main.collectionc\n');
  write('main/main.atlas', 'images {\n  image: "/main/logo.png"\n}\n');
  write('main/logo.png', 'x');
  write('main/main.script', 'function init(self)\nend\n');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(installs, { recursive: true, force: true });
  fs.rmSync(cache, { recursive: true, force: true });
});

describe.skipIf(!fs.existsSync(hook))('post-edit hook (built bundle)', () => {
  it('is silent for a valid collection', () => {
    const f = write(
      'main/main.collection',
      'name: "main"\nscale_along_z: 0\nembedded_instances {\n  id: "go"\n  data: "components {\\n"\n  "  id: \\"main\\"\\n"\n  "  component: \\"/main/main.script\\"\\n"\n  "}\\n"\n  ""\n}\n',
    );
    const r = runHook('post-edit', { tool_name: 'Write', tool_input: { file_path: f }, cwd: root });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('blocks on schema errors with file and line', () => {
    const f = write('main/bad.collection', 'name: "main"\ninstances {\n  id: "a"\n  prototyp: "/main/a.go"\n}\n');
    const r = runHook('post-edit', { tool_name: 'Edit', tool_input: { file_path: f }, cwd: root });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('/main/bad.collection:4');
    expect(r.stderr).toContain('did you mean "prototype"');
  });

  it('only warns about an unknown field when the installed Defold is not the schema version', () => {
    const f = write('main/newer.go', 'components {\n  id: "s"\n  component: "/main/main.script"\n  field_from_another_version: 1\n}\n');
    const input = { tool_name: 'Write', tool_input: { file_path: f }, cwd: root };
    expect(runHook('post-edit', input).code).toBe(2);

    const other = runHook('post-edit', input, { DEFOLD_HOME: fakeInstall('0.0.1') });
    expect(other.code).toBe(0);
    expect(JSON.parse(other.stdout).hookSpecificOutput.additionalContext).toContain('WARNING /main/newer.go:4: Unknown field "field_from_another_version"');

    // The defold_path plugin option reaches hooks under this name.
    const option = runHook('post-edit', input, { DEFOLD_HOME: '', CLAUDE_PLUGIN_OPTION_DEFOLD_PATH: fakeInstall('0.0.1') });
    expect(option.code).toBe(0);
  });

  it('checks inside embedded component data', () => {
    const f = write(
      'main/emb.go',
      'embedded_components {\n  id: "sprite"\n  type: "sprite"\n  data: "default_animation: \\"logo\\"\\n"\n  "blend_mode: BLEND_ALPHA\\n"\n  ""\n}\n',
    );
    const r = runHook('post-edit', { tool_name: 'Write', tool_input: { file_path: f }, cwd: root });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/BLEND_ALPHA.*BLEND_MODE_ALPHA/);
  });

  it('blocks on Lua syntax errors', () => {
    const f = write('main/broken.script', 'function init(self)\n  print("x"\nend\n');
    const r = runHook('post-edit', { tool_name: 'Write', tool_input: { file_path: f }, cwd: root });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('/main/broken.script:3');
  });

  it('reports warnings as context without blocking', () => {
    const f = write('main/warn.script', 'function on_message(self, message_id, message)\n  if message_id == "hit" then end\nend\n');
    const r = runHook('post-edit', { tool_name: 'Write', tool_input: { file_path: f }, cwd: root });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain('hash("hit")');
  });

  it('warns about API functions the installed Defold does not have, unless the project defines them', () => {
    write('main/util.lua', 'function go.extra() end\nreturn {}\n');
    const f = write('main/api.script', 'function init(self)\n  go.set_position(vmath.vector3())\n  go.set_visible(".", true)\n  go.extra()\n  local a = table.unpack({})\nend\n');
    const r = runHook('post-edit', { tool_name: 'Write', tool_input: { file_path: f }, cwd: root });
    expect(r.code).toBe(0);
    const context: string = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    expect(context).toContain(`WARNING /main/api.script:3:3: go.set_visible does not exist in Defold ${SCHEMA_DEFOLD_VERSION}`);
    expect(context).toContain('table.unpack does not exist');
    expect(context).toContain('did you mean the global unpack?');
    expect(context).not.toContain('go.extra');
    expect(context).not.toContain('vmath');
  });

  it('skips the API check when the installed Defold has no readable API reference', () => {
    const f = write('main/api2.script', 'function init(self)\n  go.set_visible(".", true)\nend\n');
    const r = runHook('post-edit', { tool_name: 'Write', tool_input: { file_path: f }, cwd: root }, { DEFOLD_HOME: fakeInstall('0.0.2'), DEFOLD_CACHE_DIR: path.join(cache, 'empty') });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('treats a missing referenced file as a warning', () => {
    const f = write('main/ref.go', 'components {\n  id: "s"\n  component: "/main/not_yet.script"\n}\n');
    const r = runHook('post-edit', { tool_name: 'Write', tool_input: { file_path: f }, cwd: root });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('not_yet.script');
  });

  it('respects hook_mode=warn', () => {
    const f = write('main/broken2.script', 'local x = = 1\n');
    const r = runHook('post-edit', { tool_name: 'Write', tool_input: { file_path: f }, cwd: root }, { CLAUDE_PLUGIN_OPTION_HOOK_MODE: 'warn' });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('syntax');
  });

  it('ignores non-Defold files quickly', () => {
    const r = runHook('post-edit', { tool_name: 'Write', tool_input: { file_path: path.join(root, 'notes.md') }, cwd: root });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('announces a Defold project at session start', () => {
    const r = runHook('session-start', { hook_event_name: 'SessionStart', cwd: root, source: 'startup' });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain('Defold project "Hook Test"');
  });
});
