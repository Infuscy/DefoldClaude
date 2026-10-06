import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const hook = path.resolve(here, '../../../plugins/defold/dist/hook.mjs');
let root: string;

function runHook(event: string, input: object, env: Record<string, string> = {}) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [hook, event], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - started };
}

function write(rel: string, text: string): string {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'defold hook '));
  write('game.project', '[project]\ntitle = Hook Test\n\n[bootstrap]\nmain_collection = /main/main.collectionc\n');
  write('main/main.atlas', 'images {\n  image: "/main/logo.png"\n}\n');
  write('main/logo.png', 'x');
  write('main/main.script', 'function init(self)\nend\n');
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

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
