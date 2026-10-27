// Find which project files reference a resource, a folder or a Lua module (shared by the find_references tool and tests).
import gameProjectJson from './gameproject.generated.json' with { type: 'json' };
import path from 'node:path';
import { LUA_EXTENSIONS } from './checkfile.js';
import { settingSourcePath, type SettingsSchema } from './gameproject.js';
import { messageForResource } from './schema.js';
import { validateDdf } from './validate.js';
import { luaReferences } from '../lua/refs.js';
import { parseIni } from '../util/ini.js';

export interface Reference {
  /** Referenced resource in source form (/main/x.atlas, also for built paths like /main/main.collectionc). */
  path: string;
  line: number;
  /** How the file refers to it: a field name, require "a.b", a game.project key, … */
  via: string;
  /** The reference names a folder (game.project custom_resources, bundle_resources). */
  folder?: boolean;
}

export interface Target {
  /** Resource path without a trailing slash. */
  path: string;
  folder: boolean;
}

const SHADER = /\.(vp|fp|cp|glsl)$/;
const settings = (gameProjectJson as unknown as { sections: SettingsSchema }).sections;

/** References a file makes, by type. Anything not understood structurally falls back to quoted-path text matches. */
export function fileReferences(resource: string, text: string, target: Target): Reference[] {
  const refs: Reference[] = [];
  let structured = false;
  if (LUA_EXTENSIONS.test(resource)) {
    const lua = luaReferences(text, resource);
    if (lua) {
      structured = true;
      for (const r of lua) refs.push({ path: r.path, line: r.line, via: r.kind === 'require' ? `require "${r.text}"` : `"${r.text}"` });
    }
  } else if (resource === '/game.project') {
    for (const e of parseIni(text).entries) {
      const schema = settings[e.section]?.[e.key.replace(/#\d+$/, '')];
      for (const item of e.value.split(',').map((v) => v.trim())) {
        const p = (schema?.type === 'resource' ? settingSourcePath(item, schema) : item).replace(/\/+$/, '');
        if (!p.startsWith('/')) continue;
        refs.push({ path: p, line: e.line, via: `[${e.section}] ${e.key}`, folder: !/\.[A-Za-z0-9_]+$/.test(p) || undefined });
      }
    }
  } else if (SHADER.test(resource)) {
    text.split(/\r?\n/).forEach((l, i) => {
      const m = /^\s*#include\s+"([^"]+)"/.exec(l);
      if (m) refs.push({ path: m[1]!.startsWith('/') ? m[1]! : path.posix.join(path.posix.dirname(resource), m[1]!), line: i + 1, via: `#include "${m[1]}"` });
    });
  } else if (messageForResource(resource)) {
    validateDdf(text, resource, {
      onReference(r) {
        const ctx = [r.owner ? `id "${r.owner}"` : '', r.where ? `in ${r.where}` : ''].filter(Boolean).join(', ');
        refs.push({ path: r.path, line: r.line, via: ctx ? `${r.field} (${ctx})` : r.field });
      },
    });
  }
  // Fields the schema does not know (native extension components, unknown file types) still name paths in quotes.
  if (!structured) {
    const seen = new Set(refs.filter((r) => matches(r, target)).map((r) => r.line));
    for (const m of quotedMatches(text, target)) if (!seen.has(m.line)) refs.push({ path: m.path, line: m.line, via: 'text match' });
  }
  return refs;
}

export function matches(ref: Reference, target: Target): boolean {
  if (target.folder) return ref.path === target.path || ref.path.startsWith(target.path + '/');
  // A trailing "c" is the built form of the same resource (resource.load("/x.texturec")).
  if (ref.path === target.path || ref.path === target.path + 'c') return true;
  return !!ref.folder && target.path.startsWith(ref.path + '/');
}

function quotedMatches(text: string, target: Target): Array<{ path: string; line: number }> {
  const esc = target.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Inside embedded data the quotes are escaped (\"/x.atlas\"), so allow a backslash before the closing quote.
  const re = new RegExp(`(?<=["'])${esc}(${target.folder ? `/[^"'\\\\\\r\\n]*` : 'c?'})(?=\\\\?["'])`, 'g');
  const out: Array<{ path: string; line: number }> = [];
  let line = 1;
  let last = 0;
  for (const m of text.matchAll(re)) {
    for (let i = last; i < m.index; i++) if (text.charCodeAt(i) === 10) line++;
    last = m.index;
    out.push({ path: target.folder ? m[0] : target.path, line });
  }
  return out;
}
