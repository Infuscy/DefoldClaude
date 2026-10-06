// Client for Defold's official Automation Bridge extension (defold/extension-automation-bridge, API v2):
// scene/element queries, FIFO input with receipts, and in-engine screenshots on the engine service port.
import fsp from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { EngineSession } from './engine.js';

export const BRIDGE_DEPENDENCY_REPO = 'https://github.com/defold/extension-automation-bridge';

export interface BridgeHealth {
  version: string;
  capabilities: string[];
  platform?: string;
}

export interface BridgeElement {
  id: string;
  name?: string;
  type?: string;
  kind?: string;
  text?: string;
  path?: string;
  visible?: boolean;
  enabled?: boolean;
  bounds?: { screen?: { x: number; y: number; w: number; h: number }; center?: { x: number; y: number } };
}

export class BridgeError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const SESSION = `claude-${randomUUID().slice(0, 8)}`;
let requestCounter = 0;
const healthCache = new WeakMap<EngineSession, BridgeHealth | null>();

function base(session: EngineSession): string {
  if (!session.serviceUrl) throw new BridgeError('The engine service URL is unknown.');
  return `${session.serviceUrl}/automation-bridge/v2`;
}

async function call<T>(session: EngineSession, pathAndQuery: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  const res = await fetch(base(session) + pathAndQuery, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let body: { ok?: boolean; data?: T; error?: { code?: string; message?: string; status?: number } };
  try {
    body = JSON.parse(text);
  } catch {
    throw new BridgeError(res.status === 404 ? 'not-installed' : `Unexpected bridge response (HTTP ${res.status})`, res.status === 404 ? 'not_installed' : undefined);
  }
  if (!body.ok) throw new BridgeError(body.error?.message ?? `Bridge error ${body.error?.code ?? res.status}`, body.error?.code);
  return body.data as T;
}

/** Bridge health, or null when the running engine does not include the extension. Cached per session. */
export async function bridgeHealth(session: EngineSession): Promise<BridgeHealth | null> {
  if (healthCache.has(session)) return healthCache.get(session) ?? null;
  let health: BridgeHealth | null = null;
  try {
    const d = await call<{ version?: string; capabilities?: string[]; platform?: string }>(session, '/health', {}, 2500);
    health = { version: String(d.version ?? '?'), capabilities: d.capabilities ?? [], platform: d.platform };
  } catch {
    health = null;
  }
  healthCache.set(session, health);
  return health;
}

function mutating(params: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  q.set('client_id', 'claude');
  q.set('session_id', SESSION);
  q.set('request_id', `r${++requestCounter}`);
  return q.toString();
}

export async function findElements(
  session: EngineSession,
  query: { text?: string; name?: string; type?: string; kind?: string; visible?: boolean; limit?: number },
): Promise<{ elements: BridgeElement[]; matched: number; total: number }> {
  const q = new URLSearchParams({ include: 'bounds', limit: String(query.limit ?? 50) });
  if (query.text) q.set('text', query.text);
  if (query.name) q.set('name', query.name);
  if (query.type) q.set('type', query.type);
  if (query.kind) q.set('kind', query.kind);
  if (query.visible) q.set('visible', '1');
  return call(session, `/elements?${q}`);
}

/** Find the single best element for a user-facing target ("Play", "logo", an element id). */
export async function resolveTarget(session: EngineSession, target: string): Promise<BridgeElement> {
  if (/^e:[0-9a-f]+$/.test(target)) return { id: target };
  const byText = await findElements(session, { text: target, visible: true, limit: 20 });
  const byName = await findElements(session, { name: target, visible: true, limit: 20 });
  const all = [...byText.elements, ...byName.elements].filter((e) => e.bounds?.screen && e.bounds.screen.w > 0 && e.bounds.screen.h > 0);
  const exact = all.find((e) => e.text === target || e.name === target || e.name === `/${target}`);
  const pick = exact ?? all[0];
  if (!pick) throw new BridgeError(`No visible element matches "${target}". Use inspect to list elements.`);
  return pick;
}

export interface InputReceipt {
  input_id: number;
  state: string;
  reason?: string | null;
}

export async function inputClick(session: EngineSession, at: { id?: string; x?: number; y?: number }): Promise<InputReceipt> {
  return call(session, `/input/click?${mutating({ id: at.id, x: at.x, y: at.y, visualize: 0 })}`, { method: 'POST' });
}

export async function inputDrag(
  session: EngineSession,
  from: { id?: string; x?: number; y?: number },
  to: { id?: string; x?: number; y?: number },
  duration = 0.3,
): Promise<InputReceipt> {
  const params: Record<string, string | number | undefined> = { duration, visualize: 0 };
  if (from.id) params.from_id = from.id;
  else Object.assign(params, { x1: from.x, y1: from.y });
  if (to.id) params.to_id = to.id;
  else Object.assign(params, { x2: to.x, y2: to.y });
  return call(session, `/input/drag?${mutating(params)}`, { method: 'POST' });
}

export async function inputKey(session: EngineSession, opts: { keys?: string[]; text?: string; hold?: number }): Promise<InputReceipt> {
  const params: Record<string, string | number | undefined> = {};
  if (opts.keys?.length) params.keys = opts.keys.map((k) => `{${k.toUpperCase().startsWith('KEY_') ? k.toUpperCase() : 'KEY_' + k.toUpperCase()}}`).join('');
  if (opts.text) params.text = opts.text;
  if (opts.hold) params.hold = opts.hold;
  return call(session, `/input/key?${mutating(params)}`, { method: 'POST' });
}

export async function inputWheel(session: EngineSession, at: { id?: string; x?: number; y?: number }, steps: number): Promise<InputReceipt> {
  return call(session, `/input/wheel?${mutating({ id: at.id, x: at.x, y: at.y, steps })}`, { method: 'POST' });
}

/** Wait until an input action has been fully injected (released), cancelled or failed. */
export async function waitForInput(session: EngineSession, inputId: number, timeoutMs = 5000): Promise<InputReceipt> {
  const deadline = Date.now() + timeoutMs;
  let last: InputReceipt = { input_id: inputId, state: 'accepted' };
  while (Date.now() < deadline) {
    try {
      last = await call<InputReceipt>(session, `/input/status?input_id=${inputId}`);
    } catch {
      break;
    }
    if (['released', 'cancelled', 'failed'].includes(last.state)) return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  return last;
}

export async function windowSize(session: EngineSession): Promise<{ width: number; height: number }> {
  const s = await call<{ window?: { width: number; height: number } }>(session, '/screen');
  return { width: s.window?.width ?? 0, height: s.window?.height ?? 0 };
}

/** In-engine screenshot: schedule a capture, wait for completion, read the PNG the engine wrote. */
export async function bridgeScreenshot(session: EngineSession): Promise<Buffer> {
  const job = await call<{ capture_id: number; state: string; path: string }>(session, '/screenshot');
  const deadline = Date.now() + 10_000;
  let state = job;
  while (state.state === 'pending' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    state = await call(session, `/screenshot/status?capture_id=${job.capture_id}`);
  }
  if (state.state !== 'complete') throw new BridgeError(`Screenshot did not complete (${state.state}).`);
  const png = await fsp.readFile(state.path);
  await fsp.rm(state.path, { force: true });
  return png;
}
