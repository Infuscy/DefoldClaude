import { describe, expect, it } from 'vitest';
import { LogBuffer } from '../../src/runtime/logs.js';
import { encodeExit, encodeReloadBatches, encodeResize } from '../../src/runtime/protobuf.js';
import { changedResources } from '../../src/runtime/engine.js';

describe('LogBuffer', () => {
  it('extracts Lua runtime errors with traceback (engine stdout format)', () => {
    const logs = new LogBuffer();
    logs.append(
      "INFO:ENGINE: Engine service started on port 54714\nERROR:SCRIPT: main/main.script:5: attempt to index local 't' (a nil value)\nstack traceback:\n  main/main.script:5: in function <main/main.script:1>\n\nDEBUG:SCRIPT: hello\n",
    );
    const errors = logs.luaErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ resource: '/main/main.script', line: 5, message: "attempt to index local 't' (a nil value)" });
    expect(errors[0]!.traceback).toEqual(['main/main.script:5: in function <main/main.script:1>']);
  });

  it('filters by level, grep and cursor', () => {
    const logs = new LogBuffer();
    logs.append('INFO:ENGINE: a\nWARNING:RESOURCE: b\nERROR:SCRIPT: /x.lua:1: c\nDEBUG:SCRIPT: d\n');
    expect(logs.query({ level: 'error' }).lines.map((l) => l.text)).toEqual(['ERROR:SCRIPT: /x.lua:1: c']);
    expect(logs.query({ level: 'warning' }).lines).toHaveLength(2);
    expect(logs.query({ grep: 'debug:script' }).lines).toHaveLength(1);
    expect(logs.query({ grep: '/^INFO/' }).lines).toHaveLength(1);
    expect(logs.query({ after: 3 }).lines.map((l) => l.text)).toEqual(['DEBUG:SCRIPT: d']);
    expect(logs.cursor).toBe(4);
  });

  it('keeps partial lines until they are complete', () => {
    const logs = new LogBuffer();
    logs.append('DEBUG:SCRIPT: par');
    expect(logs.cursor).toBe(0);
    logs.append('tial\n');
    expect(logs.query({}).lines[0]!.text).toBe('DEBUG:SCRIPT: partial');
  });
});

describe('protobuf encoding', () => {
  it('encodes Exit and Resize', () => {
    expect([...encodeExit(0)]).toEqual([0x08, 0x00]);
    expect([...encodeResize(300, 2)]).toEqual([0x08, 0xac, 0x02, 0x10, 0x02]);
  });

  it('splits reload messages into batches under the size limit', () => {
    const paths = Array.from({ length: 60 }, (_, i) => `/level/objects/object_number_${i}.goc`);
    const batches = encodeReloadBatches(paths, 1000);
    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) expect(b.length).toBeLessThanOrEqual(1000);
    expect(batches.reduce((n, b) => n + b.length, 0)).toBe(paths.reduce((n, p) => n + 2 + p.length, 0));
  });
});

describe('changedResources', () => {
  it('reports only compiled resources whose content changed', () => {
    const stamp = (hash: string) => ({ size: 1, mtimeMs: 1, hash });
    const before = new Map([
      ['/main/main.scriptc', stamp('a')],
      ['/main/main.collectionc', stamp('b')],
      ['/game.projectc', stamp('c')],
      ['/_generated_1.sprite', stamp('d')],
    ]);
    const after = new Map([
      ['/main/main.scriptc', stamp('a2')],
      ['/main/main.collectionc', stamp('b')],
      ['/game.projectc', stamp('c2')],
      ['/_generated_1.sprite', stamp('d2')],
      ['/main/new.scriptc', stamp('e')],
    ]);
    expect(changedResources(before, after)).toEqual(['/main/main.scriptc']);
  });
});
