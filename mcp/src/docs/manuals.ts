// Official Defold manuals and examples from https://defold.com/llms-*.txt, cached locally (fetched at runtime,
// never redistributed). Each file is one Markdown document with an H1 per manual/example:
//   # Addressing {#manuals:addressing}
//   # Easing Functions (Tweens) {#examples:animation:easing}
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { cacheRoot } from '../env/platform.js';
import { writeFileAtomic } from '../util/fsx.js';
import { logInfo } from '../util/log.js';

export type DocSource = 'manuals' | 'examples';

export interface DocEntry {
  source: DocSource;
  /** "addressing" for manuals, "animation:easing" for examples. */
  id: string;
  title: string;
  category?: string;
  brief?: string;
  text: string;
}

export interface DocSet {
  source: DocSource;
  entries: DocEntry[];
  /** Category → ids, in site navigation order. */
  categories: Array<{ name: string; ids: string[] }>;
  fetchedAt: number;
  stale: boolean;
}

const URLS: Record<DocSource, string> = {
  manuals: 'https://defold.com/llms-manuals.txt',
  examples: 'https://defold.com/llms-examples.txt',
};
const TTL_MS = 7 * 24 * 3600 * 1000;
const memo = new Map<DocSource, DocSet>();

export async function loadDocs(source: DocSource): Promise<DocSet> {
  const cached = memo.get(source);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;
  const file = path.join(cacheRoot(), 'docs', `llms-${source}.txt`);
  let text: string | undefined;
  let fetchedAt = 0;
  let stale = false;
  try {
    const st = fs.statSync(file);
    fetchedAt = st.mtimeMs;
    text = await fsp.readFile(file, 'utf8');
  } catch {
    text = undefined;
  }
  if (!text || Date.now() - fetchedAt > TTL_MS) {
    try {
      logInfo(`downloading ${URLS[source]}`);
      const res = await fetch(URLS[source], { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fresh = await res.text();
      if (!fresh.includes('{#')) throw new Error('unexpected content');
      await writeFileAtomic(file, fresh);
      text = fresh;
      fetchedAt = Date.now();
    } catch (err) {
      if (!text) throw new Error(`Could not download the Defold ${source} (${(err as Error).message}) and no cached copy exists.`);
      stale = true;
    }
  }
  const set = parseDocs(source, text, fetchedAt, stale);
  memo.set(source, set);
  return set;
}

export function parseDocs(source: DocSource, text: string, fetchedAt = Date.now(), stale = false): DocSet {
  const lines = text.split(/\r?\n/);
  const entries: DocEntry[] = [];
  const categories: Array<{ name: string; ids: string[] }> = [];
  const briefs = new Map<string, string>();
  let current: { id: string; title: string; start: number } | undefined;
  let inToc = true;
  let tocCategory: { name: string; ids: string[] } | undefined;
  const prefix = source === 'manuals' ? 'manuals:' : 'examples:';

  const close = (endLine: number) => {
    if (!current) return;
    const body = lines.slice(current.start, endLine).join('\n').trim();
    entries.push({ source, id: current.id, title: current.title, text: body });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h1 = /^# (.+?)\s*\{#([^}]+)\}\s*$/.exec(line);
    if (h1 && h1[2]!.startsWith(prefix)) {
      inToc = false;
      close(i);
      current = { id: h1[2]!.slice(prefix.length), title: h1[1]!, start: i + 1 };
      continue;
    }
    if (inToc) {
      const cat = /^#{2,3} (.+)$/.exec(line);
      if (cat && !/^(Manuals|Examples)$/i.test(cat[1]!.trim())) {
        tocCategory = { name: cat[1]!.trim(), ids: [] };
        categories.push(tocCategory);
        continue;
      }
      const item = /^- \[([^\]]+)\]\(#([^)]+)\)(?:\s*-\s*(.*))?$/.exec(line);
      if (item && item[2]!.startsWith(prefix)) {
        const id = item[2]!.slice(prefix.length);
        tocCategory?.ids.push(id);
        if (item[3]) briefs.set(id, item[3].trim());
      }
    }
  }
  close(lines.length);
  const categoryOf = new Map<string, string>();
  for (const c of categories) for (const id of c.ids) categoryOf.set(id, c.name);
  for (const e of entries) {
    e.category = categoryOf.get(e.id) ?? (source === 'examples' ? e.id.split(':')[0] : undefined);
    e.brief = briefs.get(e.id);
  }
  return { source, entries, categories: categories.filter((c) => c.ids.length), fetchedAt, stale };
}

export function findDoc(sets: DocSet[], name: string): DocEntry | undefined {
  const n = name.trim().toLowerCase().replace(/^(manuals|examples):/, '').replace(/^https?:\/\/defold\.com\/(manuals|examples)\//, '').replace(/\/$/, '');
  const all = sets.flatMap((s) => s.entries);
  return (
    all.find((e) => e.id.toLowerCase() === n) ??
    all.find((e) => e.id.toLowerCase().replace(/[_-]/g, '') === n.replace(/[_\-\s]/g, '')) ??
    all.find((e) => e.title.toLowerCase() === n) ??
    all.find((e) => e.id.toLowerCase().endsWith(':' + n)) ??
    all.find((e) => e.title.toLowerCase().includes(n))
  );
}

export interface DocHit {
  entry: DocEntry;
  score: number;
  sections: string[];
  snippet: string;
}

export function searchDocs(sets: DocSet[], query: string, limit = 8): DocHit[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9_.]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  if (!words.length) return [];
  const hits: DocHit[] = [];
  for (const set of sets) {
    for (const e of set.entries) {
      const title = e.title.toLowerCase();
      const text = e.text.toLowerCase();
      let score = 0;
      for (const w of words) {
        if (title.includes(w)) score += 12;
        if (e.id.includes(w)) score += 6;
        const count = countOccurrences(text, w);
        if (count) score += 2 + Math.min(count, 12);
      }
      if (!score) continue;
      if (words.every((w) => text.includes(w))) score += 10;
      const headings = e.text.split('\n').filter((l) => /^#{2,4} /.test(l));
      const sections = headings.filter((h) => words.some((w) => h.toLowerCase().includes(w))).slice(0, 4).map((h) => h.replace(/^#+\s*/, ''));
      hits.push({ entry: e, score, sections, snippet: snippetFor(e.text, words) });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

const STOP = new Set(['the', 'and', 'for', 'how', 'with', 'what', 'can', 'use', 'using', 'defold', 'does', 'from', 'into', 'when', 'that', 'this']);

function countOccurrences(text: string, word: string): number {
  let n = 0;
  let i = text.indexOf(word);
  while (i >= 0 && n < 50) {
    n++;
    i = text.indexOf(word, i + word.length);
  }
  return n;
}

function snippetFor(text: string, words: string[]): string {
  const lower = text.toLowerCase();
  let best = -1;
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  if (best < 0) return text.slice(0, 200).replace(/\s+/g, ' ');
  const start = Math.max(0, best - 120);
  return (start > 0 ? '…' : '') + text.slice(start, best + 200).replace(/\s+/g, ' ').trim() + '…';
}

/** Return one section (heading containing `section`) through the next heading of the same or higher level. */
export function extractSection(text: string, section: string): string | undefined {
  const lines = text.split('\n');
  const want = section.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{2,6}) (.+)$/.exec(lines[i]!);
    if (!m || !m[2]!.toLowerCase().includes(want)) continue;
    const level = m[1]!.length;
    let j = i + 1;
    while (j < lines.length) {
      const n = /^(#{1,6}) /.exec(lines[j]!);
      if (n && n[1]!.length <= level) break;
      j++;
    }
    return lines.slice(i, j).join('\n').trim();
  }
  return undefined;
}

export function headingsOf(text: string): string[] {
  return text
    .split('\n')
    .filter((l) => /^#{2,3} /.test(l))
    .map((l) => l.replace(/^(#+) /, (m, h: string) => '  '.repeat(h.length - 2)));
}
