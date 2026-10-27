// Client for a debug engine's TCP log service (port advertised as log_port by the engine service /info).
// After connecting the engine answers "0 OK" and then streams every log line written from that moment on.
import net from 'node:net';
import type { LogBuffer } from './logs.js';

export interface EngineInfo {
  version?: string;
  platform?: string;
  sha1?: string;
  log_port?: string | number;
}

export async function engineInfo(serviceUrl: string): Promise<EngineInfo> {
  const res = await fetch(`${serviceUrl}/info`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`${serviceUrl}/info answered HTTP ${res.status}`);
  return (await res.json()) as EngineInfo;
}

/** Connect and resolve once the handshake succeeded; later lines go to `logs`. `onClose` runs when the stream ends. */
export function connectLogService(host: string, port: number, logs: LogBuffer, onClose: () => void, timeoutMs = 5000): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let handshake = '';
    let open = false;
    const fail = (message: string) => {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail(`no answer from the log service at ${host}:${port} within ${timeoutMs / 1000} s`), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      if (open) return logs.append(chunk);
      handshake += chunk;
      const nl = handshake.indexOf('\n');
      if (nl < 0) return;
      const status = handshake.slice(0, nl).trim();
      if (!status.startsWith('0 ')) return fail(`the log service refused the connection: ${status}`);
      open = true;
      clearTimeout(timer);
      resolve(socket);
      logs.append(handshake.slice(nl + 1));
    });
    socket.on('error', (err) => {
      if (!open) fail(`cannot connect to the log service at ${host}:${port}: ${err.message}`);
    });
    socket.on('close', () => {
      if (!open) return;
      logs.flush();
      onClose();
    });
  });
}
