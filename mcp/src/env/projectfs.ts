// Resolve Defold resource paths across the project, fetched library zips (.internal/lib) and builtins.
import fs from 'node:fs';
import path from 'node:path';
import builtinsJson from '../ddf/builtins.generated.json' with { type: 'json' };
import { parseIni } from '../util/ini.js';
import { ZipFile } from './zip.js';
import { projectDependencies, type DefoldProject } from './project.js';

const BUILTINS = new Set<string>((builtinsJson as { files: string[] }).files);

interface Library {
  zip: string;
  /** Path prefix inside the zip (the archive's root folder, e.g. "monarch-5.1.0/"). */
  prefix: string;
  includeDirs: string[];
  entries: Set<string>; // resource paths ("/monarch/monarch.lua")
}

const libCache = new Map<string, { stamp: string; libs: Library[] }>();

/** Library archives fetched into .internal/lib with their include_dirs and file lists. */
export async function loadLibraries(project: DefoldProject): Promise<Library[]> {
  const dir = path.join(project.root, '.internal', 'lib');
  let zips: string[] = [];
  try {
    zips = fs.readdirSync(dir).filter((f) => f.endsWith('.zip')).sort();
  } catch {
    zips = [];
  }
  const stamp = zips.map((z) => `${z}:${safeStat(path.join(dir, z))}`).join('|');
  const hit = libCache.get(project.root);
  if (hit && hit.stamp === stamp) return hit.libs;
  const libs: Library[] = [];
  for (const z of zips) {
    const file = path.join(dir, z);
    let zip: ZipFile | undefined;
    try {
      zip = await ZipFile.open(file);
      const names = [...zip.entries.keys()];
      const gp = names.filter((n) => /(^|\/)game\.project$/.test(n)).sort((a, b) => a.length - b.length)[0];
      const prefix = gp ? gp.slice(0, gp.length - 'game.project'.length) : '';
      let includeDirs: string[] = [];
      if (gp) {
        const ini = parseIni(await zip.readText(gp));
        includeDirs = (ini.get('library', 'include_dirs') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      }
      const entries = new Set<string>();
      for (const n of names) {
        if (n.endsWith('/') || !n.startsWith(prefix)) continue;
        const rel = n.slice(prefix.length);
        const top = rel.split('/')[0]!;
        if (!includeDirs.length || includeDirs.includes(top)) entries.add('/' + rel);
      }
      libs.push({ zip: file, prefix, includeDirs, entries });
    } catch {
      // unreadable archive: ignore
    } finally {
      zip?.close();
    }
  }
  libCache.set(project.root, { stamp, libs });
  return libs;
}

function safeStat(p: string): string {
  try {
    const s = fs.statSync(p);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return '0';
  }
}

export type Origin = { kind: 'project'; file: string } | { kind: 'library'; zip: string; entry: string } | { kind: 'builtin'; resource: string };

/** Where a resource lives, or undefined if it cannot be found. */
export async function locateResource(project: DefoldProject, resource: string): Promise<Origin | undefined> {
  const res = resource.startsWith('/') ? resource : '/' + resource;
  const file = path.join(project.root, ...res.split('/').filter(Boolean));
  if (fs.existsSync(file)) return { kind: 'project', file };
  if (res.startsWith('/builtins/')) return BUILTINS.has(res) ? { kind: 'builtin', resource: res } : undefined;
  for (const lib of await loadLibraries(project)) {
    if (lib.entries.has(res)) return { kind: 'library', zip: lib.zip, entry: lib.prefix + res.slice(1) };
  }
  return undefined;
}

/**
 * Synchronous existence check for validators: true/false, or undefined when it cannot be decided
 * (dependencies declared but not fetched, so the path may belong to a library).
 */
export function makeResourceChecker(project: DefoldProject, libs: Library[]): (resource: string) => boolean | undefined {
  const unfetched = projectDependencies(project).length > libs.length;
  return (resource: string) => {
    const res = resource.startsWith('/') ? resource : '/' + resource;
    if (res.startsWith('/builtins/')) return BUILTINS.has(res) ? true : BUILTINS.size ? false : undefined;
    if (fs.existsSync(path.join(project.root, ...res.split('/').filter(Boolean)))) return true;
    if (libs.some((l) => l.entries.has(res))) return true;
    const top = res.split('/')[1] ?? '';
    if (libs.some((l) => l.includeDirs.includes(top))) return false; // the library owning this folder lacks the file
    return unfetched ? undefined : false;
  };
}

export async function readResourceText(project: DefoldProject, resource: string, readBuiltin?: (res: string) => Promise<string>): Promise<{ text: string; origin: Origin }> {
  const origin = await locateResource(project, resource);
  if (!origin) throw new Error(`Resource not found: ${resource}`);
  if (origin.kind === 'project') return { text: fs.readFileSync(origin.file, 'utf8'), origin };
  if (origin.kind === 'library') {
    const zip = await ZipFile.open(origin.zip);
    try {
      return { text: await zip.readText(origin.entry), origin };
    } finally {
      zip.close();
    }
  }
  if (!readBuiltin) throw new Error(`Reading builtins needs the Defold installation: ${resource}`);
  return { text: await readBuiltin(origin.resource), origin };
}
