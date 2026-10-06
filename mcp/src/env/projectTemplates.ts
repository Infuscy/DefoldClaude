// Official project templates, tutorials and samples as listed by the editor's welcome screen
// (jar: welcome/welcome.edn, with zip URLs pinned per editor version; the empty project is bundled in the jar).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DefoldInstall } from './locate.js';
import { openJar, readBuiltin } from './builtins.js';
import { ZipFile } from './zip.js';

export interface ProjectTemplate {
  id: string; // e.g. "mobile-game"
  category: string; // templates | tutorials | samples
  zipUrl: string;
  bundled: boolean;
  skipRoot: boolean;
}

const ALIASES: Record<string, string> = {
  empty: 'empty-project',
  mobile: 'mobile-game',
  desktop: 'desktop-game',
  poki: 'poki-html5-game',
  'html5-poki': 'poki-html5-game',
  html5: 'poki-html5-game',
  'basic-3d': 'basic-3d-project',
  '3d': 'basic-3d-project',
  platformer: 'platformer-game',
  rive: 'rive-project',
  extension: 'native-extension',
};

export async function listTemplates(install: DefoldInstall): Promise<ProjectTemplate[]> {
  const edn = await readBuiltin(install, 'welcome/welcome.edn');
  const out: ProjectTemplate[] = [];
  let category = 'templates';
  const re = /:label\s+"welcome\.tab\.([a-z-]+)"|\{:name\s+"welcome\.new-project\.([^"]+)\.title"([\s\S]*?)\}/g;
  for (const m of edn.matchAll(re)) {
    if (m[1]) {
      category = m[1];
      continue;
    }
    const body = m[3] ?? '';
    const url = /:zip-url\s+"([^"]+)"/.exec(body)?.[1];
    if (!url) continue;
    out.push({ id: m[2]!, category, zipUrl: url, bundled: /:bundle\s+true/.test(body), skipRoot: /:skip-root\?\s+true/.test(body) });
  }
  return out;
}

export function findTemplate(templates: ProjectTemplate[], wanted: string): ProjectTemplate | undefined {
  const w = (ALIASES[wanted.toLowerCase()] ?? wanted).toLowerCase();
  return templates.find((t) => t.id === w) ?? templates.find((t) => t.id.startsWith(w)) ?? templates.find((t) => t.id.includes(w));
}

/** Extract a template into `dest` (must be empty or missing) and set its title. Returns the files written. */
export async function createFromTemplate(install: DefoldInstall, template: ProjectTemplate, dest: string, title?: string): Promise<string[]> {
  if (fs.existsSync(dest) && fs.readdirSync(dest).length) throw new Error(`${dest} is not empty. Choose a new or empty folder.`);
  const tmp = path.join(os.tmpdir(), `defold-template-${process.pid}-${Date.now()}.zip`);
  try {
    if (template.bundled && install.jarPath) {
      const jar = await openJar(install);
      await fsp.writeFile(tmp, await jar.read(`template-projects/welcome.new-project.${template.id}.title.zip`));
    } else {
      const res = await fetch(template.zipUrl, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}) for ${template.zipUrl}`);
      await fsp.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
    }
    const written = await extractZip(tmp, dest, template.skipRoot);
    if (title) setProjectTitle(path.join(dest, 'game.project'), title);
    return written;
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}

async function extractZip(zipFile: string, dest: string, skipRoot: boolean): Promise<string[]> {
  const zip = await ZipFile.open(zipFile);
  const written: string[] = [];
  try {
    const names = zip.list().map((e) => e.name);
    const root = skipRoot ? commonRoot(names) : '';
    const destAbs = path.resolve(dest);
    for (const name of names) {
      const rel = name.slice(root.length);
      if (!rel) continue;
      const target = path.resolve(destAbs, rel);
      if (!target.startsWith(destAbs + path.sep)) throw new Error(`Unsafe path in template archive: ${name}`);
      await zip.extract(name, target);
      written.push(rel);
    }
  } finally {
    zip.close();
  }
  return written;
}

function commonRoot(names: string[]): string {
  const first = names[0]?.split('/')[0];
  return first && names.every((n) => n.startsWith(first + '/')) ? first + '/' : '';
}

export function setProjectTitle(gameProject: string, title: string): void {
  if (!fs.existsSync(gameProject)) return;
  const text = fs.readFileSync(gameProject, 'utf8');
  const lines = text.split(/\r?\n/);
  let section = '';
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    const s = /^\[(.*)\]\s*$/.exec(lines[i]!);
    if (s) section = s[1]!;
    else if (section === 'project' && /^title\s*=/.test(lines[i]!)) {
      lines[i] = `title = ${title}`;
      replaced = true;
      break;
    }
  }
  let out = lines.join('\n');
  if (!replaced) out = /^\[project\]/m.test(out) ? out.replace(/^\[project\][^\n]*\n/m, (m) => `${m}title = ${title}\n`) : `[project]\ntitle = ${title}\n\n${out}`;
  fs.writeFileSync(gameProject, out);
}
