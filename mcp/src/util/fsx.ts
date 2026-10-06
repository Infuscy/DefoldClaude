import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function readTextSync(p: string): string | undefined {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return undefined;
  }
}

export async function readText(p: string): Promise<string | undefined> {
  try {
    return await fsp.readFile(p, 'utf8');
  } catch {
    return undefined;
  }
}

export function readJsonSync<T>(p: string): T | undefined {
  const text = readTextSync(p);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export async function ensureDir(p: string): Promise<void> {
  await fsp.mkdir(p, { recursive: true });
}

/** Write via a temp file + rename so readers never observe a half-written file. */
export async function writeFileAtomic(p: string, data: string | Uint8Array): Promise<void> {
  await ensureDir(path.dirname(p));
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, data);
  try {
    await fsp.rename(tmp, p);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

/** Recursively list files below `root`, skipping directory names in `skip`. Paths are absolute. */
export async function walkFiles(root: string, skip: Set<string>, limit = 50_000): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < limit) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!skip.has(e.name)) stack.push(path.join(dir, e.name));
      } else if (e.isFile()) {
        out.push(path.join(dir, e.name));
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}
