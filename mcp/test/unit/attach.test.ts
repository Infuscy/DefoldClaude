// run action=attach against a fake engine: HTTP engine service (/ping, /info, /post) plus the TCP log service.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getSession, sleep, stopSession } from '../../src/runtime/engine.js';
import { runTool } from '../../src/tools/run.js';
import { logsTool } from '../../src/tools/logs.js';
import { logsInput, runInput } from '../../src/tools/schemas.js';

interface FakeEngine {
  port: number;
  logPort: number;
  emit(line: string): void;
  close(): Promise<void>;
  posts: string[];
}

async function fakeEngine(handshake = '0 OK\n'): Promise<FakeEngine> {
  const clients = new Set<net.Socket>();
  const logServer = net.createServer((c) => {
    clients.add(c);
    c.write(handshake);
    c.on('close', () => clients.delete(c));
  });
  await new Promise<void>((r) => logServer.listen(0, '127.0.0.1', r));
  const logPort = (logServer.address() as net.AddressInfo).port;
  const posts: string[] = [];
  const service = http.createServer((req, res) => {
    if (req.url === '/ping') return res.end('PONG\n');
    if (req.url === '/info') return res.end(JSON.stringify({ version: '1.13.2', platform: 'arm64-android', sha1: 'x', log_port: String(logPort) }));
    if (req.url?.startsWith('/post/')) {
      posts.push(req.url);
      res.end('');
      if (req.url === '/post/@system/exit') setTimeout(() => void engine.close(), 50);
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => service.listen(0, '127.0.0.1', r));
  const engine: FakeEngine = {
    port: (service.address() as net.AddressInfo).port,
    logPort,
    posts,
    emit: (line) => clients.forEach((c) => c.write(line + '\n')),
    close: async () => {
      clients.forEach((c) => c.destroy());
      await Promise.all([new Promise((r) => logServer.close(r)), new Promise((r) => service.close(r))]);
    },
  };
  return engine;
}

let tmp: string;
const ctx = { signal: new AbortController().signal, progress: async () => {} };
const text = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;
const run = async (args: object) => text(await runTool.handler(runInput.parse({ project: tmp, backend: 'bob', wait_seconds: 0, ...args }), ctx));

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'defold attach '));
  fs.writeFileSync(path.join(tmp, 'game.project'), '[project]\ntitle = Attach\n');
});
afterEach(async () => {
  const s = getSession(tmp);
  if (s && !s.exited) s.exited = { code: null, signal: null };
  s?.logSocket?.destroy();
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('run action=attach', () => {
  it('streams the engine log into logs, sends commands and notices when the engine stops', async () => {
    const engine = await fakeEngine();
    const out = await run({ action: 'attach', port: engine.port });
    expect(out).toContain(`Attached to the engine at http://127.0.0.1:${engine.port} (Defold 1.13.2, arm64-android)`);
    expect(out).toContain(`Streaming its log from port ${engine.logPort}`);

    engine.emit('DEBUG:SCRIPT: hello from the device');
    engine.emit('ERROR:SCRIPT: /main/main.script:3: attempt to index a nil value');
    await sleep(150);
    const logs = text(await logsTool.handler(logsInput.parse({ project: tmp }), ctx));
    expect(logs).toContain('Game running via attached');
    expect(logs).toContain('hello from the device');
    expect(logs).toMatch(/Lua errors in this range \(1\):\n- .*main\.script:3/);

    expect(await run({ action: 'command', command: 'toggle_physics_debug' })).toContain('toggle_physics_debug: OK');
    expect(await run({ action: 'reload' })).toMatch(/attached engine runs its own build/);

    const session = getSession(tmp)!;
    await stopSession(session);
    expect(engine.posts).toContain('/post/@system/exit');
    expect(session.exited).toBeDefined();
    await sleep(100);
    expect(session.logs.query({}).lines.map((l) => l.text)).toContain('--- engine stopped (log stream closed) ---');
  });

  it('marks the game stopped when the log stream ends and the engine is gone', async () => {
    const engine = await fakeEngine();
    await run({ action: 'attach', port: engine.port });
    await engine.close();
    await sleep(300);
    expect(getSession(tmp)!.exited).toBeDefined();
  });

  it('still attaches when the log service refuses, and explains why there is no log', async () => {
    const engine = await fakeEngine('1 busy\n');
    const out = await run({ action: 'attach', port: engine.port });
    expect(out).toContain('No log stream: the log service refused the connection: 1 busy');
    expect(getSession(tmp)!.backend).toBe('attached');
    await engine.close();
  });

  it('fails clearly when nothing answers', async () => {
    const free = net.createServer();
    await new Promise<void>((r) => free.listen(0, '127.0.0.1', r));
    const port = (free.address() as net.AddressInfo).port;
    await new Promise((r) => free.close(r));
    // The tool registry turns a thrown error into an isError result.
    await expect(run({ action: 'attach', port })).rejects.toThrow(/No Defold engine service answers at http:\/\/127\.0\.0\.1:\d+/);
  });
});
