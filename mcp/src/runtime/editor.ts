// Client for the Defold editor's local HTTP API (Defold 1.13.2+: blocking /command/<name> endpoints).
import { editorPortFiles, type DefoldProject } from '../env/project.js';
import { logDebug } from '../util/log.js';
import type { Issue, Severity } from './issues.js';

export interface EditorConnection {
  baseUrl: string;
  port: number;
  token?: string;
  paths: Set<string>;
}

export interface EditorBuildResult {
  httpStatus: number;
  success: boolean;
  issues: Issue[];
  targetUrl?: string;
  raw: unknown;
}

/** Returns a connection if the editor has this project open and answers on its port. */
export async function connectEditor(project: DefoldProject, timeoutMs = 1500): Promise<EditorConnection | undefined> {
  const { port, token } = editorPortFiles(project);
  if (!port) return undefined;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${baseUrl}/openapi.json`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    const spec = (await res.json()) as { paths?: Record<string, unknown> };
    return { baseUrl, port, token, paths: new Set(Object.keys(spec.paths ?? {})) };
  } catch (err) {
    logDebug('editor not reachable', err);
    return undefined;
  }
}

/** The blocking per-command endpoints arrived in Defold 1.13.2. */
export function supportsBlockingCommands(conn: EditorConnection): boolean {
  return conn.paths.has('/command/compile') && conn.paths.has('/command/run');
}

export async function editorCommand(
  conn: EditorConnection,
  name: string,
  options: { query?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<EditorBuildResult> {
  const qs = options.query ? '?' + new URLSearchParams(options.query).toString() : '';
  const signals = [AbortSignal.timeout(options.timeoutMs ?? 900_000)];
  if (options.signal) signals.push(options.signal);
  const res = await fetch(`${conn.baseUrl}/command/${name}${qs}`, { method: 'POST', signal: AbortSignal.any(signals) });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // plain text answer
  }
  if (res.status === 403) {
    return { httpStatus: 403, success: false, issues: [{ severity: 'error', message: `The editor refused "${name}" (command not available right now — is another build or a dialog open?)` }], raw: body };
  }
  if (res.status === 404) {
    return { httpStatus: 404, success: false, issues: [{ severity: 'error', message: `This Defold editor version has no "${name}" command.` }], raw: body };
  }
  const obj = (typeof body === 'object' && body) as { success?: boolean; issues?: EditorIssue[]; target?: { url?: string } } | false;
  const issues = obj && Array.isArray(obj.issues) ? obj.issues.map(convertIssue) : [];
  const success = obj ? obj.success ?? res.ok : res.ok;
  if (!success && !issues.length && typeof body === 'string' && body.trim()) issues.push({ severity: 'error', message: body.trim() });
  return { httpStatus: res.status, success, issues, targetUrl: obj ? obj.target?.url : undefined, raw: body };
}

interface EditorIssue {
  message: string;
  severity?: string;
  resource?: string;
  range?: { start?: { line?: number; character?: number } };
}

function convertIssue(i: EditorIssue): Issue {
  const severity: Severity = i.severity === 'warning' ? 'warning' : i.severity === 'information' ? 'info' : 'error';
  const line = i.range?.start?.line;
  const ch = i.range?.start?.character;
  return {
    severity,
    resource: i.resource,
    line: typeof line === 'number' ? line + 1 : undefined,
    column: typeof ch === 'number' ? ch + 1 : undefined,
    message: i.message,
  };
}

export interface ConsoleSnapshot {
  lines: string[];
}

export async function editorConsole(conn: EditorConnection): Promise<ConsoleSnapshot> {
  const res = await fetch(`${conn.baseUrl}/console`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Editor console request failed (${res.status})`);
  const body = (await res.json()) as { lines?: string[] };
  return { lines: Array.isArray(body.lines) ? body.lines : [] };
}

export async function editorPreview(conn: EditorConnection, resource: string, width: number, height: number): Promise<Buffer> {
  if (!conn.paths.has('/preview/{path}')) throw new Error('This Defold editor version cannot render previews (needs 1.13.1+).');
  const clean = resource.replace(/^\/+/, '');
  const url = `${conn.baseUrl}/preview/${clean.split('/').map(encodeURIComponent).join('/')}?width=${width}&height=${height}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Preview failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function editorBob(
  conn: EditorConnection,
  options: Record<string, unknown>,
  commands: string[],
  timeoutMs = 1_800_000,
): Promise<EditorBuildResult> {
  if (!conn.token) throw new Error('The editor token file (.internal/editor.token) is missing.');
  const res = await fetch(`${conn.baseUrl}/bob`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${conn.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ options, commands }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let body: { success?: boolean; issues?: EditorIssue[] } | undefined;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const issues = body?.issues?.map(convertIssue) ?? (res.ok ? [] : [{ severity: 'error' as const, message: text.trim() || `HTTP ${res.status}` }]);
  return { httpStatus: res.status, success: body?.success ?? res.ok, issues, raw: body ?? text };
}
