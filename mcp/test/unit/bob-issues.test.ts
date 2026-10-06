import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cleanBobLog, parseBobOutput } from '../../src/runtime/issues.js';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/bob');
const read = (name: string) => fs.readFileSync(path.join(fixtures, name), 'utf8');

describe('parseBobOutput', () => {
  it('reports a Lua syntax error with resource and line, without Java noise', () => {
    const issues = parseBobOutput(read('bob-syntax.log'));
    expect(issues).toEqual([{ severity: 'error', resource: '/main/main.script', line: 3, message: "missing ')' at 'end'" }]);
  });

  it('reports a missing texture referenced by an embedded component', () => {
    const issues = parseBobOutput(read('bob-missing.log'));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("the texture '/main/missing.atlas' can't be found");
    expect(issues[0]!.resource).toBeUndefined();
  });

  it('parses task failure lines', () => {
    const issues = parseBobOutput(
      'The build failed for the following reasons:\nERROR /main/player.go:4 Unknown field "componet"\nERROR /main/hud.gui Missing font\n',
    );
    expect(issues).toEqual([
      { severity: 'error', resource: '/main/player.go', line: 4, message: 'Unknown field "componet"' },
      { severity: 'error', resource: '/main/hud.gui', line: undefined, message: 'Missing font' },
    ]);
  });

  it('strips progress lines and JVM warnings from logs', () => {
    expect(cleanBobLog(' 50% Reading classes\nWARNING: A restricted method in java.lang.System has been called\nreal line')).toBe('real line');
  });
});
