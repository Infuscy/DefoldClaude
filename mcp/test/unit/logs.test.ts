import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { compactLog, formatErrors, headTail, LogBuffer } from '../../src/runtime/logs.js';
import { readLines } from '../../src/runtime/processes.js';
import { encodeExit, encodeReloadBatches, encodeResize } from '../../src/runtime/protobuf.js';
import { changedResources } from '../../src/runtime/engine.js';

describe('readLines', () => {
  it('emits whole lines when a line or a multi-byte character is split across chunks', async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    readLines(stream, (l) => lines.push(l));
    const bytes = Buffer.from('INFO:ENGINE: Engine service started on port 54714\r\nDEBUG:SCRIPT: héllo\nlast line without newline', 'utf8');
    const inPortLine = bytes.indexOf('port') + 2;
    const inCharacter = bytes.indexOf(0xc3) + 1; // between the two bytes of "é"
    stream.write(bytes.subarray(0, inPortLine));
    stream.write(bytes.subarray(inPortLine, inCharacter));
    stream.end(bytes.subarray(inCharacter));
    await new Promise((r) => stream.on('end', r));
    expect(lines).toEqual(['INFO:ENGINE: Engine service started on port 54714', 'DEBUG:SCRIPT: héllo', 'last line without newline']);
  });

  it('flushes an unfinished line once', async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    const reader = readLines(stream, (l) => lines.push(l));
    stream.write('done\npartial');
    await vi.waitFor(() => expect(lines).toEqual(['done']));
    reader.flush();
    reader.flush();
    expect(lines).toEqual(['done', 'partial']);
  });
});

describe('LogBuffer', () => {
  it('extracts Lua runtime errors with traceback (engine stdout format)', () => {
    const logs = new LogBuffer();
    logs.append(
      "INFO:ENGINE: Engine service started on port 54714\nERROR:SCRIPT: main/main.script:5: attempt to index local 't' (a nil value)\nstack traceback:\n  main/main.script:5: in function <main/main.script:1>\n\nDEBUG:SCRIPT: hello\n",
    );
    const { errors } = logs.errors();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.group).toMatchObject({ domain: 'SCRIPT', resource: '/main/main.script', line: 5, message: "attempt to index local 't' (a nil value)" });
    expect(errors[0]!.group.traceback).toEqual(['main/main.script:5: in function <main/main.script:1>']);
    expect(errors[0]).toMatchObject({ count: 1, first: 2, atLeast: false });
  });

  // One error repeating every frame in update next to three engine errors logged once in init.
  const UPDATE_ERROR = "ERROR:SCRIPT: main/player.script:10: attempt to index local 't' (a nil value)\nstack traceback:\n  main/player.script:10: in function <main/player.script:8>\n";
  const INIT_ERRORS = [
    "ERROR:GAMEOBJECT: Instance '/no_such_object' could not be found when dispatching message 'hello' sent from main:/player#player",
    "ERROR:GAMEOBJECT: Component '/player#no_such_component' could not be found when dispatching message 'hello' sent from main:/player#player",
    "ERROR:GAMESYS: Unable to play animation 'no_such_animation' from texture '/main/sprites.texturec' since it could not be found.",
  ];

  it('groups every error-level line by location and message, in order of first occurrence', () => {
    const logs = new LogBuffer();
    logs.append('DEBUG:SCRIPT: errors e2e init\n' + INIT_ERRORS.join('\n') + '\n');
    for (let i = 0; i < 300; i++) logs.append(UPDATE_ERROR);
    logs.append('FATAL:ENGINE: out of memory\nWARNING:RESOURCE: not an error\n');
    const { errors } = logs.errors();
    expect(errors.map((e) => [e.group.domain, e.count])).toEqual([
      ['GAMEOBJECT', 1],
      ['GAMEOBJECT', 1],
      ['GAMESYS', 1],
      ['SCRIPT', 300],
      ['ENGINE', 1],
    ]);
    expect(errors[3]!.group).toMatchObject({ resource: '/main/player.script', line: 10, first: 5 });
    expect(errors[3]!.group.traceback).toEqual(['main/player.script:10: in function <main/player.script:8>']);
    expect(errors[4]!.group.level).toBe('fatal');
  });

  it('keeps reporting errors after their lines have left the ring buffer', () => {
    const logs = new LogBuffer(100);
    logs.append(INIT_ERRORS.join('\n') + '\n');
    for (let i = 0; i < 200; i++) logs.append(UPDATE_ERROR);
    expect(logs.query({ max: 1000 }).lines.some((l) => l.text.includes('no_such_object'))).toBe(false);
    const { errors } = logs.errors();
    expect(errors.map((e) => e.count)).toEqual([1, 1, 1, 200]);
    expect(errors[0]!.group.message).toContain("Instance '/no_such_object' could not be found");
  });

  it('counts only occurrences after the cursor', () => {
    const logs = new LogBuffer();
    logs.append(INIT_ERRORS[0] + '\n');
    for (let i = 0; i < 10; i++) logs.append(UPDATE_ERROR);
    const cursor = logs.cursor;
    for (let i = 0; i < 4; i++) logs.append(UPDATE_ERROR);
    logs.append(INIT_ERRORS[2] + '\n');
    const { errors } = logs.errors(cursor);
    expect(errors.map((e) => [e.group.domain, e.count, e.first])).toEqual([
      ['SCRIPT', 4, cursor + 1],
      ['GAMESYS', 1, cursor + 13],
    ]);
    expect(logs.errors(logs.cursor).errors).toEqual([]);
  });

  it('gives a lower bound once the cursor is older than the occurrences tracked one by one', () => {
    const logs = new LogBuffer(20_000, { recent: 8 });
    for (let i = 0; i < 50; i++) logs.append(UPDATE_ERROR);
    expect(logs.errors(0).errors[0]).toMatchObject({ count: 50, atLeast: false });
    const late = logs.errors(logs.cursor - 3 * 3).errors[0]!;
    expect(late).toMatchObject({ count: 3, atLeast: false });
    const early = logs.errors(10).errors[0]!;
    expect(early.atLeast).toBe(true);
    expect(early.count).toBeLessThanOrEqual(47);
    expect(formatErrors(logs.errors(10), { scope: 'in this range' })).toMatch(/^Errors in this range \(\d+\+, 1 distinct\):\n- .*\[\d+\+×, last at log line 148\]/);
  });

  it('bounds the number of distinct errors, keeping the first ones', () => {
    const logs = new LogBuffer(20_000, { groups: 25 });
    for (let i = 0; i < 60; i++) logs.append(`ERROR:SCRIPT: main/x.script:${i + 1}: boom\n`);
    const { errors, droppedGroups } = logs.errors();
    expect(errors).toHaveLength(25);
    expect(droppedGroups).toBe(35);
    expect(errors[0]!.group.line).toBe(1);
    expect(errors[19]!.group.line).toBe(20);
    expect(errors[24]!.group.line).toBe(60);
    expect(logs.errors(logs.cursor - 1).droppedGroups).toBe(0);
  });

  it('formats grouped errors with counts and where they were first seen', () => {
    const logs = new LogBuffer();
    logs.append(INIT_ERRORS[0] + '\n');
    for (let i = 0; i < 3; i++) logs.append(UPDATE_ERROR);
    expect(formatErrors(logs.errors(), { scope: 'since start' })).toBe(
      [
        'Errors since start (4, 2 distinct):',
        "- GAMEOBJECT: Instance '/no_such_object' could not be found when dispatching message 'hello' sent from main:/player#player  [log line 1]",
        "- /main/player.script:10: attempt to index local 't' (a nil value)  [3×, first at log line 2]",
        '    main/player.script:10: in function <main/player.script:8>',
      ].join('\n'),
    );
    expect(formatErrors(new LogBuffer().errors(), { scope: 'since start', none: 'No errors so far.' })).toBe('No errors so far.');
  });

  it('folds repeated error blocks and identical consecutive lines for display', () => {
    const logs = new LogBuffer();
    logs.append('DEBUG:SCRIPT: init\n');
    // dmengine ends each traceback with an empty line.
    for (let i = 0; i < 3; i++) logs.append(UPDATE_ERROR + '\nDEBUG:SCRIPT: tick\n');
    logs.append('DEBUG:SCRIPT: done\n');
    const lines = logs.query({ max: 1000 }).lines;
    expect(compactLog(lines).map((l) => l.text)).toEqual([
      'DEBUG:SCRIPT: init',
      "ERROR:SCRIPT: main/player.script:10: attempt to index local 't' (a nil value)  [×3 in this range, last at log line 12]",
      'stack traceback:',
      '  main/player.script:10: in function <main/player.script:8>',
      '',
      'DEBUG:SCRIPT: tick  [×3]',
      'DEBUG:SCRIPT: done',
    ]);
    expect(compactLog(lines, { tracebacks: false }).map((l) => l.text)).toEqual([
      'DEBUG:SCRIPT: init',
      "ERROR:SCRIPT: main/player.script:10: attempt to index local 't' (a nil value)  [×3 in this range, last at log line 12]",
      'DEBUG:SCRIPT: tick  [×3]',
      'DEBUG:SCRIPT: done',
    ]);
    const entries = compactLog(lines);
    expect(headTail(entries, 2, 1)).toEqual([entries[0]!.text, entries[1]!.text, '… 4 more line(s) omitted (logs cursor=2 continues from here) …', 'DEBUG:SCRIPT: done']);
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
