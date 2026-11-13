// The build tool and the run actions that build share one lock per project: two bob runs would write build/agent at once.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/** Stand-in for bob: counts how many builds run at the same time. `gate` holds a build open until released. */
const bob = vi.hoisted(() => ({ active: 0, peak: 0, gate: undefined as Promise<void> | undefined }));

vi.mock('../../src/runtime/bob.js', () => {
  const run = async () => {
    bob.active++;
    bob.peak = Math.max(bob.peak, bob.active);
    await (bob.gate ?? new Promise((r) => setTimeout(r, 40)));
    bob.active--;
    return { success: false, issues: [{ severity: 'error', message: 'stub build' }], log: '', durationMs: 0, timedOut: false, args: [] };
  };
  return { buildHeadless: run, runBob: run };
});

import { buildTool } from '../../src/tools/build.js';
import { runTool } from '../../src/tools/run.js';
import { buildInput, runInput } from '../../src/tools/schemas.js';

let tmp: string;
let project: string;
const ctx = { signal: new AbortController().signal, progress: async () => {} };
const text = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;
const build = (args: object = {}) => buildTool.handler(buildInput.parse({ project, backend: 'bob', ...args }), ctx);
const run = (args: object = {}) => runTool.handler(runInput.parse({ project, backend: 'bob', wait_seconds: 0, ...args }), ctx);

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'defold lock '));
  project = path.join(tmp, 'game');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'game.project'), '[project]\ntitle = Lock\n');
  // The tools only need an install to exist; bob itself is replaced above.
  const install = path.join(tmp, 'defold');
  fs.mkdirSync(install);
  fs.writeFileSync(path.join(install, 'config'), '[build]\nversion = 0.0.0\n');
  process.env.DEFOLD_HOME = install;
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('build lock', () => {
  it('never runs two builds of one project at once, whichever tool starts them', async () => {
    const results = await Promise.all([build(), run({ action: 'start' }), build({ command: 'resolve' })]);
    expect(bob.peak).toBe(1);
    expect(text(results[1]!)).toContain('Build FAILED — the game was not started');
  });

  it('does not make run stop wait for a build', async () => {
    let release!: () => void;
    bob.gate = new Promise<void>((r) => (release = r));
    try {
      const building = build();
      await vi.waitFor(() => expect(bob.active).toBe(1));
      expect(text(await run({ action: 'stop' }))).toContain('No running game');
      expect(bob.active).toBe(1);
      release();
      await building;
    } finally {
      release();
      bob.gate = undefined;
    }
  });
});
