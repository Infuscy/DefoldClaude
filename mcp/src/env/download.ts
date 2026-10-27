// bob.jar and the API reference (ref-doc.zip) from d.defold.com, for machines without the Defold editor.
// Only on request (status download=…), https only, cached per engine sha1. bob.jar also carries dmengine and builtins.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { readJsonSync } from '../util/fsx.js';
import { cacheRoot } from './platform.js';
import { ZipFile } from './zip.js';

export interface DownloadedDefold {
  version: string;
  sha1: string;
  channel?: string;
  dir: string;
  jarPath: string;
  docsPath: string;
  downloadedAt: string;
}

export interface DownloadSources {
  archive: string;
  github: string;
}

export const DEFOLD_SOURCES: DownloadSources = { archive: 'https://d.defold.com', github: 'https://api.github.com' };

const CHANNELS = ['stable', 'beta', 'alpha'];
const FILES = { jar: 'bob/bob.jar', docs: 'engine/share/ref-doc.zip' } as const;

export function downloadsRoot(): string {
  return path.join(cacheRoot(), 'defold');
}

/** Completed downloads, newest first. */
export function listDownloads(): DownloadedDefold[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(downloadsRoot());
  } catch {
    return [];
  }
  const out: DownloadedDefold[] = [];
  for (const name of names) {
    const meta = readJsonSync<DownloadedDefold>(path.join(downloadsRoot(), name, 'download.json'));
    if (meta && fs.existsSync(meta.jarPath) && fs.existsSync(meta.docsPath)) out.push(meta);
  }
  return out.sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt));
}

/** "stable" / "beta" / "alpha" (latest of that channel) or a release such as "1.13.2" → version and engine sha1. */
export async function resolveVersion(spec: string, sources = DEFOLD_SOURCES): Promise<{ version: string; sha1: string; channel?: string }> {
  const s = spec.trim().toLowerCase();
  if (CHANNELS.includes(s)) {
    const info = (await getJson(`${sources.archive}/${s}/info.json`)) as { version?: string; sha1?: string };
    if (!info.version || !info.sha1) throw new Error(`${sources.archive}/${s}/info.json has no version/sha1.`);
    return { version: info.version, sha1: info.sha1, channel: s };
  }
  if (!/^\d+\.\d+\.\d+$/.test(s)) throw new Error(`Unknown Defold version "${spec}": use stable, beta, alpha or a release number such as 1.13.2.`);
  // Release tags are annotated: the ref points at a tag object, which points at the engine commit.
  let obj: { type?: string; sha?: string; url?: string } | undefined;
  try {
    obj = ((await getJson(`${sources.github}/repos/defold/defold/git/ref/tags/${s}`)) as { object?: typeof obj }).object;
  } catch (err) {
    throw new Error(`Defold ${s} not found on GitHub (https://github.com/defold/defold/releases): ${(err as Error).message}`);
  }
  if (obj?.type === 'tag') obj = ((await getJson(`${sources.github}/repos/defold/defold/git/tags/${obj.sha}`)) as { object?: typeof obj }).object;
  if (obj?.type !== 'commit' || !obj.sha) throw new Error(`Could not resolve the commit of Defold ${s}.`);
  return { version: s, sha1: obj.sha };
}

/** Download (or reuse) bob.jar and ref-doc.zip for `spec`. */
export async function downloadDefold(
  spec: string,
  options: { onProgress?: (message: string, percent?: number) => void; signal?: AbortSignal; sources?: DownloadSources } = {},
): Promise<{ download: DownloadedDefold; cached: boolean }> {
  const sources = options.sources ?? DEFOLD_SOURCES;
  const { version, sha1, channel } = await resolveVersion(spec, sources);
  const cached = listDownloads().find((d) => d.sha1 === sha1);
  if (cached) return { download: cached, cached: true };

  const dir = path.join(downloadsRoot(), sha1);
  await fsp.mkdir(dir, { recursive: true });
  const jarPath = path.join(dir, 'bob.jar');
  const docsPath = path.join(dir, 'ref-doc.zip');
  for (const [file, dest, check] of [
    [FILES.docs, docsPath, 'doc/'],
    [FILES.jar, jarPath, 'com/dynamo/bob/Bob.class'],
  ] as const) {
    if (await isDefoldZip(dest, check)) continue; // finished in an earlier, interrupted attempt
    const url = `${sources.archive}/archive/${sha1}/${file}`;
    await downloadFile(url, dest, (done, total) => options.onProgress?.(`Downloading ${path.basename(dest)} for Defold ${version}`, total ? Math.round((done / total) * 100) : undefined), options.signal);
    if (!(await isDefoldZip(dest, check))) {
      await fsp.rm(dest, { force: true });
      throw new Error(`The downloaded ${path.basename(dest)} is not a valid Defold archive (missing ${check}); try again.`);
    }
  }
  const download: DownloadedDefold = { version, sha1, channel, dir, jarPath, docsPath, downloadedAt: new Date().toISOString() };
  await fsp.writeFile(path.join(dir, 'download.json'), JSON.stringify(download, null, 1));
  return { download, cached: false };
}

async function isDefoldZip(file: string, mustContain: string): Promise<boolean> {
  if (!fs.existsSync(file)) return false;
  try {
    const zip = await ZipFile.open(file);
    try {
      return mustContain.endsWith('/') ? zip.list(mustContain).length > 0 : zip.has(mustContain);
    } finally {
      zip.close();
    }
  } catch {
    return false;
  }
}

async function downloadFile(url: string, dest: string, onProgress: (done: number, total?: number) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetchFollowing(url, signal);
  const total = Number(res.headers.get('content-length')) || undefined;
  const part = `${dest}.part`;
  let done = 0;
  let lastReport = 0;
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  body.on('data', (chunk: Buffer) => {
    done += chunk.length;
    if (Date.now() - lastReport > 1000) {
      lastReport = Date.now();
      onProgress(done, total);
    }
  });
  try {
    await pipeline(body, fs.createWriteStream(part), { signal });
    if (total !== undefined && done !== total) throw new Error(`Download of ${url} stopped after ${done} of ${total} bytes.`);
    await fsp.rename(part, dest);
  } catch (err) {
    await fsp.rm(part, { force: true });
    throw err;
  }
}

/**
 * GET with redirects followed by hand: d.defold.com redirects archive URLs to a channel folder, sometimes as http://.
 * Every hop must stay on the starting host and is upgraded to https (plain http only for loopback test servers).
 */
async function fetchFollowing(url: string, signal?: AbortSignal): Promise<Response> {
  const host = new URL(url).host;
  let current = secure(new URL(url));
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(current, { redirect: 'manual', signal: signal ?? AbortSignal.timeout(30 * 60_000) });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`${current} redirected without a location.`);
      const next = new URL(location, current);
      if (next.host !== host) throw new Error(`${current} redirected to another host (${next.host}); refusing to download from it.`);
      current = secure(next);
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`Download failed: ${current} answered HTTP ${res.status}.`);
    return res;
  }
  throw new Error(`Too many redirects for ${url}.`);
}

function secure(u: URL): URL {
  const loopback = u.hostname === 'localhost' || u.hostname === '[::1]' || /^127\./.test(u.hostname);
  if (u.protocol === 'http:' && !loopback) u.protocol = 'https:';
  if (u.protocol !== 'https:' && !loopback) throw new Error(`Refusing to download over ${u.protocol} (${u.href}).`);
  return u;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetchFollowing(url);
  try {
    return await res.json();
  } catch {
    throw new Error(`${url} did not return JSON.`);
  }
}
