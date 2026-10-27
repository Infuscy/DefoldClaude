// run start overrides (collection/config → dmengine --config) and the screenshot burst contact sheet.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadProject, type DefoldProject } from '../../src/env/project.js';
import { launchOptions } from '../../src/tools/run.js';
import { contactSheet } from '../../src/util/png.js';

let tmp: string;
let project: DefoldProject;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'defold launch '));
  fs.writeFileSync(path.join(tmp, 'game.project'), '[project]\ntitle = Launch\n');
  project = loadProject(tmp);
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('launchOptions', () => {
  it('boots a collection through its built path', () => {
    expect(launchOptions(project, '/levels/level3.collection')!.config).toEqual(['bootstrap.main_collection=/levels/level3.collectionc']);
    expect(launchOptions(project, 'levels/level3.collectionc')!.config).toEqual(['bootstrap.main_collection=/levels/level3.collectionc']);
    expect(launchOptions(project)).toBeUndefined();
  });

  it('formats config values, adds the built suffix to compiled resource settings and notes unknown keys', () => {
    const o = launchOptions(project, undefined, { 'display.width': 480, 'physics.debug': true, 'bootstrap.render': '/my.render', 'my_ext.level': 'hard' })!;
    expect(o.config).toEqual(['display.width=480', 'physics.debug=1', 'bootstrap.render=/my.renderc', 'my_ext.level=hard']);
    expect(o.notes).toEqual([expect.stringContaining('"my_ext.level" is not a game.project setting')]);
  });

  it('rejects malformed keys, non-collections and a collection given twice', () => {
    expect(() => launchOptions(project, undefined, { width: 3 })).toThrow(/must look like section.key/);
    expect(() => launchOptions(project, '/main/main.go')).toThrow(/must be a .collection file/);
    expect(() => launchOptions(project, '/a.collection', { 'bootstrap.main_collection': '/b.collectionc' })).toThrow(/not both/);
  });
});

function frame(w: number, h: number, square?: { x: number; y: number }): Buffer {
  const img = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) img.data.set([0, 80, 160, 255], i * 4);
  if (square) for (let y = square.y; y < square.y + 20; y++) for (let x = square.x; x < square.x + 20; x++) img.data.set([255, 200, 0, 255], (y * w + x) * 4);
  return PNG.sync.write(img);
}

describe('contactSheet', () => {
  it('lays frames out in a numbered grid within max size and measures change between frames', () => {
    const frames = [frame(200, 100, { x: 10, y: 40 }), frame(200, 100, { x: 60, y: 40 }), frame(200, 100, { x: 60, y: 40 }), frame(200, 100, { x: 110, y: 40 })];
    const sheet = contactSheet(frames, 400);
    expect([sheet.cols, sheet.rows]).toEqual([2, 2]);
    expect(sheet.width).toBeLessThanOrEqual(400);
    expect(sheet.width).toBe(2 * 198 + 4); // (400 - gap) / 2 per cell, aspect kept
    expect(sheet.changes[0]).toBeGreaterThan(0);
    expect(sheet.changes[1]).toBe(0);
    expect(sheet.changes[2]).toBeGreaterThan(0);

    const img = PNG.sync.read(sheet.png);
    const at = (x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];
    // The label box of frame 1 is black; one glyph pixel of the "1" is white.
    expect(at(2, 2)).toEqual([0, 0, 0]);
    expect(at(2 + 2 * 2, 2 + 1 * 2)).toEqual([255, 255, 255]);
    // The gap between columns is the dark background.
    expect(at(199, 60)).toEqual([32, 32, 32]);
  });

  it('reports no change for a static scene', () => {
    expect(contactSheet([frame(64, 64), frame(64, 64), frame(64, 64)], 256).changes).toEqual([0, 0]);
  });
});
