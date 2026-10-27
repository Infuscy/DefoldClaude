// Downloading bob.jar + ref-doc.zip from a fake d.defold.com / GitHub API, and finding the result as an install.
import fs from 'node:fs';
import http from 'node:http';
import type net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { downloadDefold, listDownloads, resolveVersion, type DownloadSources } from '../../src/env/download.js';
import { classFileJava, javaProblem, parseJavaVersion } from '../../src/env/java.js';
import { locateDefold } from '../../src/env/locate.js';

/** A stored (uncompressed) zip, enough for yauzl. */
function zip(files: Record<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const SHA1 = 'a'.repeat(40);
const bobClass = (javaVersion: number) => Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, javaVersion + 44]);
const BOB = zip({ 'com/dynamo/bob/Bob.class': bobClass(99), 'builtins/render/default.render': Buffer.from('script: ""\n') });
const DOCS = zip({ 'doc/go_doc.sdoc': Buffer.from('info { namespace: "go" }\n') });

let tmp: string;
let server: http.Server;
let sources: DownloadSources;
const requests: string[] = [];

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'defold download '));
  vi.stubEnv('DEFOLD_CACHE_DIR', path.join(tmp, 'cache'));
  server = http.createServer((req, res) => {
    const url = req.url ?? '';
    requests.push(url);
    const port = (server.address() as net.AddressInfo).port;
    const json = (v: unknown) => res.end(JSON.stringify(v));
    if (url === '/stable/info.json') return json({ version: '1.99.0', sha1: SHA1 });
    if (url === '/beta/info.json') return json({ version: '1.97.0', sha1: 'c'.repeat(40) });
    if (url === '/repos/defold/defold/git/ref/tags/1.98.0') return json({ object: { type: 'tag', sha: 'tagobj' } });
    if (url === '/repos/defold/defold/git/tags/tagobj') return json({ object: { type: 'commit', sha: 'b'.repeat(40) } });
    // Like d.defold.com: the sha1 URL redirects into a channel folder.
    const m = /^\/archive\/([0-9a-f]{40})\/(.*)$/.exec(url);
    if (m) {
      res.writeHead(301, { location: m[1] === 'c'.repeat(40) ? `http://localhost:${port}/elsewhere` : `http://127.0.0.1:${port}/archive/stable/${m[1]}/${m[2]}` });
      return res.end();
    }
    if (url.endsWith('/bob/bob.jar')) return res.end(BOB);
    if (url.endsWith('/engine/share/ref-doc.zip')) return res.end(DOCS);
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  sources = { archive: base, github: base };
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('resolveVersion', () => {
  it('reads channels from info.json and releases from annotated GitHub tags', async () => {
    expect(await resolveVersion('stable', sources)).toEqual({ version: '1.99.0', sha1: SHA1, channel: 'stable' });
    expect(await resolveVersion('1.98.0', sources)).toEqual({ version: '1.98.0', sha1: 'b'.repeat(40) });
    await expect(resolveVersion('latest', sources)).rejects.toThrow(/use stable, beta, alpha or a release number/);
    await expect(resolveVersion('1.0.0', sources)).rejects.toThrow(/not found on GitHub/);
  });

  it('refuses plain http to a real host', async () => {
    await expect(resolveVersion('stable', { archive: 'ftp://d.defold.com', github: '' })).rejects.toThrow(/Refusing to download over ftp:/);
  });
});

describe('downloadDefold', () => {
  it('follows the redirect, stores both archives under the sha1 and reuses them', async () => {
    const first = await downloadDefold('stable', { sources });
    expect(first.cached).toBe(false);
    expect(first.download.dir).toBe(path.join(tmp, 'cache', 'defold', SHA1));
    expect(fs.readFileSync(first.download.jarPath)).toEqual(BOB);
    expect(fs.readFileSync(first.download.docsPath)).toEqual(DOCS);
    expect(requests).toContain(`/archive/stable/${SHA1}/bob/bob.jar`);

    const before = requests.length;
    expect((await downloadDefold('stable', { sources })).cached).toBe(true);
    expect(requests.slice(before)).toEqual(['/stable/info.json']);
    expect(listDownloads().map((d) => d.version)).toEqual(['1.99.0']);
  });

  it('refuses a redirect to another host', async () => {
    // The c…c archive redirects to localhost:<port>, a different host than 127.0.0.1:<port>.
    await expect(downloadDefold('beta', { sources })).rejects.toThrow(/redirected to another host \(localhost:\d+\); refusing/);
    expect(listDownloads().map((d) => d.version)).toEqual(['1.99.0']);
  });

  it('is found as an install when no editor is present, with the API docs taken from ref-doc.zip', () => {
    const empty = path.join(tmp, 'empty');
    for (const k of ['LOCALAPPDATA', 'APPDATA', 'ProgramFiles', 'USERPROFILE', 'HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME']) vi.stubEnv(k, empty);
    for (const k of ['DEFOLD_HOME', 'EVAL_DEFOLD_HOME', 'DEFOLD_BOB_JAR']) vi.stubEnv(k, '');
    const { install } = locateDefold({ refresh: true });
    if (fs.existsSync('C:\\Defold') || fs.existsSync('/opt/Defold') || fs.existsSync('/usr/local/Defold')) return; // a fixed-path install wins
    expect(install?.source).toBe('download');
    expect(install?.version).toBe('1.99.0');
    expect(install?.docsPath).toMatch(/ref-doc\.zip$/);
  });
});

describe('Java requirement', () => {
  it('parses java -version output of old and new JDKs', () => {
    expect(parseJavaVersion('openjdk version "25.0.1" 2025-10-21')).toBe(25);
    expect(parseJavaVersion('java version "1.8.0_401"')).toBe(8);
    expect(parseJavaVersion('openjdk version "21" 2023-09-19')).toBe(21);
    expect(parseJavaVersion('nonsense')).toBeUndefined();
  });

  it('reads the Java version bob was compiled for from its class file', async () => {
    expect(classFileJava(bobClass(25))).toBe(25);
    expect(classFileJava(Buffer.from('not a class'))).toBeUndefined();
    const jar = listDownloads()[0]!.jarPath;
    expect(await javaProblem(undefined, jar, '1.99.0')).toMatch(/^No Java found: bob for Defold 1\.99\.0 needs Java 99 or newer\. Install a JDK 99/);
  });
});
