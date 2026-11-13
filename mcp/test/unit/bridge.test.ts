// In-engine captures: the bridge reports a file path, which must only be read (and removed) for a local game and a real PNG.
import fs from 'node:fs';
import http from 'node:http';
import type net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bridgeScreenshot, readCapture, REMOTE_CAPTURE } from '../../src/runtime/bridge.js';
import { isLocalEngine, type EngineSession } from '../../src/runtime/engine.js';
import { LogBuffer } from '../../src/runtime/logs.js';

let tmp: string;
const png = PNG.sync.write(new PNG({ width: 4, height: 4 }));

function session(backend: EngineSession['backend'], serviceUrl?: string): EngineSession {
  return { projectRoot: tmp, backend, serviceUrl, logs: new LogBuffer(), startedAt: 0, consoleSeen: 0 };
}

function file(name: string, content: Buffer | string): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, content);
  return p;
}

/** A bridge that answers /screenshot with a finished capture at `capturePath`. */
async function fakeBridge(capturePath: string): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/automation-bridge/v2/screenshot')) {
      return res.end(JSON.stringify({ ok: true, data: { capture_id: 1, state: 'complete', path: capturePath } }));
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'defold bridge '));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('isLocalEngine', () => {
  it('is true for games started here and for engines attached on this machine', () => {
    expect(isLocalEngine(session('bob', 'http://127.0.0.1:8001'))).toBe(true);
    expect(isLocalEngine(session('editor'))).toBe(true);
    expect(isLocalEngine(session('attached', 'http://127.0.0.1:8001'))).toBe(true);
    expect(isLocalEngine(session('attached', 'http://localhost:8001'))).toBe(true);
    expect(isLocalEngine(session('attached', 'http://[::1]:8001'))).toBe(true);
    const own = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal);
    if (own) expect(isLocalEngine(session('attached', `http://${own.address}:8001`))).toBe(true);
  });

  it('is false for an engine attached on another machine or device', () => {
    expect(isLocalEngine(session('attached', 'http://192.0.2.10:8001'))).toBe(false);
    expect(isLocalEngine(session('attached', 'http://my-phone.example:8001'))).toBe(false);
  });
});

describe('readCapture', () => {
  it('returns a PNG capture and removes the file', async () => {
    const p = file('shot.png', png);
    expect((await readCapture(p)).equals(png)).toBe(true);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('leaves alone anything that is not a PNG image', async () => {
    const notes = file('notes.txt', 'keep me');
    await expect(readCapture(notes)).rejects.toThrow(/unexpected capture file/);
    const fake = file('fake.png', 'keep me too');
    await expect(readCapture(fake)).rejects.toThrow(/not a PNG image; it was left in place/);
    expect(fs.readFileSync(notes, 'utf8')).toBe('keep me');
    expect(fs.readFileSync(fake, 'utf8')).toBe('keep me too');
    await expect(readCapture(path.join(tmp, 'missing.png'))).rejects.toThrow(/Could not read the capture/);
    await expect(readCapture(undefined)).rejects.toThrow(/unexpected capture file/);
  });
});

describe('bridgeScreenshot', () => {
  it('reads the capture a local engine saved', async () => {
    const p = file('frame.png', png);
    const bridge = await fakeBridge(p);
    try {
      expect((await bridgeScreenshot(session('attached', bridge.url))).equals(png)).toBe(true);
      expect(fs.existsSync(p)).toBe(false);
    } finally {
      await bridge.close();
    }
  });

  it('does not read or delete a file the engine names when it is not a capture', async () => {
    const victim = file('settings.json', '{"keep":true}');
    const bridge = await fakeBridge(victim);
    try {
      await expect(bridgeScreenshot(session('attached', bridge.url))).rejects.toThrow(/unexpected capture file/);
      expect(fs.readFileSync(victim, 'utf8')).toBe('{"keep":true}');
    } finally {
      await bridge.close();
    }
  });

  it('explains that a game on another machine cannot be captured, without asking it', async () => {
    await expect(bridgeScreenshot(session('attached', 'http://192.0.2.10:8001'))).rejects.toThrow(REMOTE_CAPTURE);
  });
});
