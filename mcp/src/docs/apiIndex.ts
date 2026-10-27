// Lua API reference for the installed Defold version, built from the editor jar's doc/*.sdoc files,
// plus `.script_api` files (native extension APIs) found in the project and its fetched libraries.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type { DefoldInstall } from '../env/locate.js';
import { cacheRoot } from '../env/platform.js';
import type { DefoldProject } from '../env/project.js';
import { ZipFile } from '../env/zip.js';
import { parseTextFormat, toPlain, type PlainObject } from '../ddf/textformat.js';
import { walkFiles, writeFileAtomic } from '../util/fsx.js';
import { logInfo } from '../util/log.js';

export interface ApiParam {
  name: string;
  types: string[];
  doc: string;
  optional: boolean;
}

export interface ApiElement {
  name: string;
  type: string; // FUNCTION | MESSAGE | PROPERTY | CONSTANT | VARIABLE | ENUM | TYPEDEF | ...
  namespace: string;
  brief: string;
  description: string;
  params: ApiParam[];
  returns: ApiParam[];
  examples: string;
  members: Array<{ name: string; doc: string; type: string }>;
  environment: 'runtime' | 'editor';
  /** Extra qualifier, e.g. "Box2D v2" / "Box2D v3" or an extension name. */
  variant?: string;
  source: string;
}

const REPEATED = new Set(['elements', 'parameters', 'returnvalues', 'members', 'types', 'notes', 'tparams']);
const INDEX_VERSION = 3;

let memo: { key: string; elements: ApiElement[] } | undefined;

export async function loadApiIndex(install: DefoldInstall): Promise<ApiElement[]> {
  const key = install.sha1 ?? install.jarPath ?? 'unknown';
  if (memo?.key === key) return memo.elements;
  const cacheFile = path.join(cacheRoot(), 'api', `${key}.v${INDEX_VERSION}.json`);
  try {
    const elements = JSON.parse(await fsp.readFile(cacheFile, 'utf8')) as ApiElement[];
    memo = { key, elements };
    return elements;
  } catch {
    // build below
  }
  const source = install.docsPath ?? install.jarPath;
  if (!source) throw new Error('No Defold jar available to read the API documentation from.');
  logInfo('building API index from', source);
  const elements: ApiElement[] = [];
  const zip = await ZipFile.open(source);
  try {
    for (const entry of zip.list('doc/')) {
      if (!entry.name.endsWith('.sdoc')) continue;
      const doc = toPlain(parseTextFormat(await zip.readText(entry.name)).root, REPEATED);
      elements.push(...fromSdoc(doc, entry.name));
    }
  } finally {
    zip.close();
  }
  await writeFileAtomic(cacheFile, JSON.stringify(elements));
  memo = { key, elements };
  return elements;
}

function fromSdoc(doc: PlainObject, file: string): ApiElement[] {
  const info = (doc.info ?? {}) as PlainObject;
  const language = String(info.language ?? '');
  if (language !== 'Lua') return [];
  const namespace = String(info.namespace ?? '');
  const srcPath = String(info.path ?? '');
  const environment: ApiElement['environment'] = file.includes('editor.apidoc') ? 'editor' : 'runtime';
  const variant = /box2d\/v2\//.test(srcPath) ? 'Box2D v2' : /box2d\/v3\//.test(srcPath) ? 'Box2D v3' : undefined;
  const out: ApiElement[] = [];
  for (const raw of (doc.elements ?? []) as PlainObject[]) {
    const params = ((raw.parameters ?? []) as PlainObject[]).map(toParam);
    const returns = ((raw.returnvalues ?? []) as PlainObject[]).map(toParam);
    const members = ((raw.members ?? []) as PlainObject[]).map((m) => ({ name: String(m.name ?? ''), doc: clean(String(m.doc ?? '')), type: String(m.type ?? '') }));
    out.push({
      name: String(raw.name ?? ''),
      type: String(raw.type ?? ''),
      namespace,
      brief: clean(String(raw.brief ?? '')),
      description: clean(String(raw.description ?? '')),
      params,
      returns,
      examples: clean(String(raw.examples ?? '')),
      members,
      environment,
      variant,
      source: srcPath || file,
    });
  }
  return out;
}

function toParam(p: PlainObject): ApiParam {
  const types = Array.isArray(p.types) ? p.types.map(String) : p.types ? [String(p.types)] : [];
  return { name: String(p.name ?? ''), types, doc: clean(String(p.doc ?? '')), optional: p.is_optional === true || p.is_optional === 'true' };
}

/** Turn Defold doc markup into plain Markdown. */
export function clean(text: string): string {
  return text
    .replace(/\[ref:([^\]]+)\]/g, '`$1`')
    .replace(/\[type:([^\]]+)\]/g, '$1')
    .replace(/\[icon:[^\]]+\]\s*/g, '')
    .replace(/<a [^>]*>([\s\S]*?)<\/a>/g, '$1')
    .replace(/<\/?code>/g, '`')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/?(p|b|i|em|strong|span|ul|ol|li|table|tr|td|th|thead|tbody|div|pre)[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Native extension APIs from .script_api files (YAML).

const projectApiMemo = new Map<string, { stamp: string; elements: ApiElement[] }>();

export async function loadProjectApis(project: DefoldProject): Promise<ApiElement[]> {
  const libDir = path.join(project.root, '.internal', 'lib');
  let libs: string[] = [];
  try {
    libs = fs.readdirSync(libDir).filter((f) => f.endsWith('.zip')).sort();
  } catch {
    libs = [];
  }
  const files = (await walkFiles(project.root, new Set(['build', '.internal', '.git', 'node_modules']), 20_000)).filter((f) => f.endsWith('.script_api'));
  const stamp = [...libs, ...files.map((f) => `${f}:${safeMtime(f)}`)].join('|');
  const hit = projectApiMemo.get(project.root);
  if (hit && hit.stamp === stamp) return hit.elements;

  const elements: ApiElement[] = [];
  for (const f of files) {
    try {
      elements.push(...fromScriptApi(await fsp.readFile(f, 'utf8'), path.relative(project.root, f)));
    } catch {
      // ignore malformed files
    }
  }
  for (const lib of libs) {
    let zip: ZipFile | undefined;
    try {
      zip = await ZipFile.open(path.join(libDir, lib));
      for (const e of zip.list()) {
        if (e.name.endsWith('.script_api')) elements.push(...fromScriptApi(await zip.readText(e.name), `${lib}:${e.name}`));
      }
    } catch {
      // ignore unreadable archives
    } finally {
      zip?.close();
    }
  }
  projectApiMemo.set(project.root, { stamp, elements });
  return elements;
}

function safeMtime(f: string): number {
  try {
    return fs.statSync(f).mtimeMs;
  } catch {
    return 0;
  }
}

interface ScriptApiNode {
  name?: string;
  type?: string;
  desc?: string;
  members?: ScriptApiNode[];
  parameters?: Array<{ name?: string; type?: string | string[]; desc?: string; optional?: boolean }>;
  returns?: Array<{ name?: string; type?: string | string[]; desc?: string }>;
  examples?: Array<{ desc?: string }> | string;
}

function fromScriptApi(text: string, source: string): ApiElement[] {
  const doc = YAML.parse(text) as ScriptApiNode[] | ScriptApiNode | null;
  const roots = Array.isArray(doc) ? doc : doc ? [doc] : [];
  const out: ApiElement[] = [];
  const visit = (node: ScriptApiNode, prefix: string, ns: string) => {
    const name = prefix ? `${prefix}.${node.name ?? ''}` : node.name ?? '';
    const kind = (node.type ?? '').toLowerCase();
    if (kind === 'table') {
      for (const m of node.members ?? []) visit(m, name, ns || name);
      if (!prefix) return;
    }
    out.push({
      name,
      type: kind === 'function' ? 'FUNCTION' : kind === 'table' ? 'TABLE' : kind ? kind.toUpperCase() : 'VARIABLE',
      namespace: ns || name.split('.')[0]!,
      brief: (node.desc ?? '').split('\n')[0]!.trim(),
      description: node.desc ?? '',
      params: (node.parameters ?? []).map((p) => ({ name: p.name ?? '', types: ([] as string[]).concat(p.type ?? []), doc: p.desc ?? '', optional: !!p.optional })),
      returns: (node.returns ?? []).map((r) => ({ name: r.name ?? '', types: ([] as string[]).concat(r.type ?? []), doc: r.desc ?? '', optional: false })),
      examples: typeof node.examples === 'string' ? node.examples : (node.examples ?? []).map((e) => e.desc ?? '').join('\n\n'),
      members: [],
      environment: 'runtime',
      variant: `extension (${source})`,
      source,
    });
  };
  for (const r of roots) visit(r, '', '');
  return out;
}

// ---------------------------------------------------------------------------------------------
// Search and rendering

export interface SearchOptions {
  namespace?: string;
  environment?: 'runtime' | 'editor' | 'all';
  limit?: number;
}

export function findExact(elements: ApiElement[], name: string, environment: SearchOptions['environment'] = 'all'): ApiElement[] {
  const n = name.trim();
  const pool = filterEnv(elements, environment);
  let hits = pool.filter((e) => e.name === n);
  if (!hits.length) hits = pool.filter((e) => e.name.toLowerCase() === n.toLowerCase());
  if (!hits.length && !n.includes('.')) hits = pool.filter((e) => e.name.toLowerCase().endsWith('.' + n.toLowerCase()));
  return hits;
}

/** Vocabulary from other engines/frameworks mapped to the Defold API that does the job. */
const SYNONYMS: Record<string, string[]> = {
  move: ['go.animate', 'go.set_position', 'go.get_position'],
  tween: ['go.animate', 'gui.animate'],
  lerp: ['vmath.lerp', 'go.animate'],
  transition: ['go.animate', 'gui.animate'],
  destroy: ['go.delete'],
  remove: ['go.delete', 'gui.delete_node'],
  kill: ['go.delete'],
  spawn: ['factory.create', 'collectionfactory.create'],
  instantiate: ['factory.create', 'collectionfactory.create'],
  clone: ['factory.create', 'gui.clone'],
  wait: ['timer.delay'],
  sleep: ['timer.delay'],
  delay: ['timer.delay'],
  schedule: ['timer.delay'],
  coroutine: ['timer.delay'],
  rotate: ['go.set_rotation', 'vmath.quat_rotation_z', 'go.animate'],
  distance: ['vmath.length'],
  normalize: ['vmath.normalize'],
  random: ['math.random', 'math.randomseed'],
  text: ['label.set_text', 'gui.set_text'],
  audio: ['sound.play', 'sound.stop'],
  music: ['sound.play'],
  scene: ['collectionproxy.missing_resources', 'proxy_loaded'],
  level: ['proxy_loaded', 'collectionfactory.create'],
  save: ['sys.save', 'sys.get_save_file'],
  load: ['sys.load', 'sys.get_save_file'],
  storage: ['sys.save', 'sys.load'],
  keyboard: ['acquire_input_focus'],
  input: ['acquire_input_focus'],
  touch: ['acquire_input_focus', 'gui.pick_node'],
  click: ['acquire_input_focus', 'gui.pick_node'],
  button: ['gui.pick_node'],
  velocity: ['linear_velocity', 'apply_force'],
  force: ['apply_force'],
  impulse: ['apply_force'],
  overlap: ['trigger_response', 'physics.raycast'],
  quit: ['sys.exit'],
  exit: ['sys.exit'],
  log: ['pprint', 'print'],
  print: ['pprint', 'print'],
  timer: ['timer.delay', 'timer.cancel'],
  json: ['json.encode', 'json.decode'],
  window: ['window.get_size', 'window.set_listener'],
  screen: ['window.get_size', 'camera.screen_to_world'],
  fullscreen: ['defos'],
  camera: ['camera.screen_to_world', 'camera.world_to_screen'],
  url: ['msg.url'],
  send: ['msg.post'],
  message: ['msg.post'],
  event: ['msg.post'],
  parent: ['set_parent', 'go.get_parent'],
  visible: ['enable', 'disable', 'gui.set_enabled'],
  hide: ['disable', 'gui.set_enabled'],
  show: ['enable', 'gui.set_enabled'],
  color: ['tint', 'gui.set_color'],
  alpha: ['tint', 'gui.set_alpha'],
  flip: ['sprite.set_hflip', 'sprite.set_vflip'],
  animation: ['sprite.play_flipbook', 'go.animate'],
};

export function searchApi(elements: ApiElement[], query: string, options: SearchOptions = {}): ApiElement[] {
  const q = query.trim().toLowerCase();
  const words = q.split(/[\s,()]+/).filter((w) => w.length > 1);
  const boosted = new Set<string>();
  for (const w of words) for (const target of SYNONYMS[w] ?? []) boosted.add(target);
  let pool = filterEnv(elements, options.environment ?? 'runtime');
  if (options.namespace) {
    const ns = options.namespace.toLowerCase();
    pool = pool.filter((e) => e.namespace.toLowerCase() === ns || e.namespace.toLowerCase().startsWith(ns + '.'));
  }
  const scored: Array<[number, ApiElement]> = [];
  for (const e of pool) {
    const name = e.name.toLowerCase();
    const short = name.split('.').pop()!;
    const brief = e.brief.toLowerCase();
    const desc = e.description.toLowerCase();
    let score = 0;
    if (q && name === q) score += 1000;
    else if (q && short === q) score += 600;
    else if (q && name.includes(q)) score += 300;
    for (const w of words) {
      if (short === w) score += 120;
      else if (name.includes(w)) score += 60;
      if (brief.includes(w)) score += 25;
      if (desc.includes(w)) score += 6;
    }
    if (words.length > 1 && words.every((w) => name.includes(w) || brief.includes(w))) score += 80;
    if (boosted.has(e.name)) score += 150;
    if (score > 0) {
      if (e.type === 'FUNCTION') score += 5;
      if (e.variant === 'Box2D v3' || e.variant === 'Box2D v2') score -= 20; // prefer the high-level physics API
      scored.push([score, e]);
    }
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, options.limit ?? 12).map(([, e]) => e);
}

function filterEnv(elements: ApiElement[], environment: SearchOptions['environment']): ApiElement[] {
  if (!environment || environment === 'all') return elements;
  return elements.filter((e) => e.environment === environment);
}

export function signature(e: ApiElement): string {
  if (e.type !== 'FUNCTION') return e.name;
  const args = e.params.map((p) => (p.optional ? `[${p.name}]` : p.name)).join(', ');
  return `${e.name}(${args})`;
}

export function renderBrief(e: ApiElement): string {
  const kind = e.type === 'FUNCTION' ? '' : ` [${e.type.toLowerCase()}]`;
  const variant = e.variant ? ` (${e.variant})` : '';
  const env = e.environment === 'editor' ? ' (editor script)' : '';
  return `${signature(e)}${kind}${variant}${env} — ${e.brief}`;
}

export function renderFull(e: ApiElement): string {
  const lines: string[] = [];
  const kind = e.type.toLowerCase();
  lines.push(`### ${signature(e)}`);
  lines.push(`${kind}${e.variant ? ` · ${e.variant}` : ''}${e.environment === 'editor' ? ' · editor scripts' : ''} · namespace ${e.namespace}`);
  if (e.brief) lines.push('', e.brief);
  if (e.description && e.description !== e.brief) lines.push('', e.description);
  if (e.params.length) {
    lines.push('', e.type === 'MESSAGE' ? 'Message fields:' : 'Parameters:');
    for (const p of e.params) lines.push(`- \`${p.name}\`${p.optional ? ' (optional)' : ''} ${p.types.length ? `[${p.types.join(' | ')}]` : ''} ${p.doc}`.trimEnd());
  }
  if (e.returns.length) {
    lines.push('', 'Returns:');
    for (const r of e.returns) lines.push(`- \`${r.name}\` ${r.types.length ? `[${r.types.join(' | ')}]` : ''} ${r.doc}`.trimEnd());
  }
  if (e.members.length) {
    lines.push('', 'Members:');
    for (const m of e.members.slice(0, 60)) lines.push(`- \`${m.name}\` ${m.doc}`.trimEnd());
  }
  if (e.examples) lines.push('', 'Examples:', e.examples);
  return lines.join('\n');
}
