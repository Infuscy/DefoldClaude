import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeProjectPath, resolveProject, toResourcePath } from '../../src/env/project.js';

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'defold proj '));
  fs.mkdirSync(path.join(tmp, 'game', 'main'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'game', 'game.project'), '[project]\ntitle = Test Game\n');
  fs.writeFileSync(path.join(tmp, 'game', 'main', 'main.script'), '');
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('resolveProject', () => {
  it('walks up from a file inside the project', () => {
    const p = resolveProject(path.join(tmp, 'game', 'main', 'main.script'));
    expect(p.root).toBe(path.join(tmp, 'game'));
    expect(p.title).toBe('Test Game');
  });

  it('finds a single project in a subfolder', () => {
    expect(resolveProject(tmp).root).toBe(path.join(tmp, 'game'));
  });

  it('converts between file and resource paths', () => {
    const p = resolveProject(path.join(tmp, 'game'));
    const file = path.join(tmp, 'game', 'main', 'main.script');
    expect(toResourcePath(p, file)).toBe('/main/main.script');
    expect(normalizeProjectPath(p, '/main/main.script').file).toBe(file);
    expect(normalizeProjectPath(p, 'main/main.script').resource).toBe('/main/main.script');
    expect(normalizeProjectPath(p, file).resource).toBe('/main/main.script');
    expect(() => normalizeProjectPath(p, '/../outside.txt')).toThrow();
  });
});
