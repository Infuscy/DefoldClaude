// game.project validation against the settings schema in bob's meta.properties.
import type { Issue, Severity } from '../runtime/issues.js';
import { parseIni } from '../util/ini.js';
import { closest } from './codec.js';

export interface SettingSchema {
  type?: string; // bool | integer | number | string | resource | string_array
  default?: string;
  options?: string;
  filter?: string;
  private?: boolean;
  deprecated?: boolean;
}

export type SettingsSchema = Record<string, Record<string, SettingSchema>>;

/** Parse bob's meta.properties: `[section]` then `key.attribute = value`. */
export function parseMetaProperties(text: string): SettingsSchema {
  const out: SettingsSchema = {};
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sec = /^\[(.*)\]$/.exec(line);
    if (sec) {
      section = sec[1]!.trim();
      if (section) out[section] ??= {};
      continue;
    }
    if (!section) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const lhs = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    const dot = lhs.lastIndexOf('.');
    if (dot < 0) continue; // section-level attributes (help/group)
    const key = lhs.slice(0, dot);
    const attr = lhs.slice(dot + 1);
    const entry = (out[section]![key] ??= {});
    switch (attr) {
      case 'type':
        entry.type = value;
        break;
      case 'default':
        entry.default = value;
        break;
      case 'options':
        entry.options = value;
        break;
      case 'filter':
        entry.filter = value;
        break;
      case 'private':
        entry.private = value === '1' || value === 'true';
        break;
      case 'deprecated':
        entry.deprecated = value === '1' || value === 'true';
        break;
    }
  }
  return out;
}

export interface GameProjectContext {
  schema: SettingsSchema;
  /** Resource existence check; undefined result = cannot tell. */
  resourceExists?: (resourcePath: string) => boolean | undefined;
  missingRefSeverity?: Severity;
}

export function validateGameProject(text: string, ctx: GameProjectContext): Issue[] {
  const issues: Issue[] = [];
  const doc = parseIni(text);
  const resource = '/game.project';
  const seen = new Set<string>();
  for (const e of doc.entries) {
    const sectionSchema = ctx.schema[e.section];
    const keyBase = e.key.replace(/#\d+$/, '');
    const dupKey = `${e.section}.${e.key}`;
    if (seen.has(dupKey)) issues.push({ severity: 'warning', resource, line: e.line, message: `"${e.key}" is set twice in [${e.section}]; the last value wins.`, rule: 'duplicate-key' });
    seen.add(dupKey);
    if (!sectionSchema) continue; // extension-defined section (native extensions add their own settings)
    const s = sectionSchema[keyBase];
    if (!s) {
      // Only suggest a correction that is not already set (legacy keys like app_icon_57x57 sit next to valid ones).
      const already = new Set(doc.entries.filter((x) => x.section === e.section).map((x) => x.key.replace(/#\d+$/, '')));
      const suggestion = closest(keyBase, Object.keys(sectionSchema).filter((k) => !already.has(k)));
      issues.push({
        severity: 'warning',
        resource,
        line: e.line,
        message: `Unknown setting "${keyBase}" in [${e.section}] (this Defold version ignores it)${suggestion ? `; did you mean "${suggestion}"?` : ''}`,
        rule: 'unknown-setting',
      });
      continue;
    }
    if (s.deprecated) issues.push({ severity: 'warning', resource, line: e.line, message: `[${e.section}] ${keyBase} is deprecated.`, rule: 'deprecated-setting' });
    const v = e.value;
    switch (s.type) {
      case 'bool':
        if (!/^(0|1|true|false)$/.test(v)) issues.push({ severity: 'error', resource, line: e.line, message: `[${e.section}] ${keyBase} must be 0 or 1, got "${v}".`, rule: 'setting-type' });
        break;
      case 'integer':
        if (!/^-?\d+$/.test(v)) issues.push({ severity: 'error', resource, line: e.line, message: `[${e.section}] ${keyBase} must be an integer, got "${v}".`, rule: 'setting-type' });
        break;
      case 'number':
        if (v !== '' && !Number.isFinite(Number(v))) issues.push({ severity: 'error', resource, line: e.line, message: `[${e.section}] ${keyBase} must be a number, got "${v}".`, rule: 'setting-type' });
        break;
      case 'resource':
        if (v) checkResourceSetting(e.section, keyBase, v, s, e.line, ctx, issues);
        break;
    }
    if (s.options && v) {
      const allowed = s.options.split(',').map((o) => o.split(':')[0]!.trim());
      if (allowed.length && !allowed.includes(v)) {
        issues.push({ severity: 'warning', resource, line: e.line, message: `[${e.section}] ${keyBase} = "${v}" is not one of: ${allowed.join(', ')}.`, rule: 'setting-option' });
      }
    }
  }
  return issues;
}

function checkResourceSetting(section: string, key: string, value: string, s: SettingSchema, line: number, ctx: GameProjectContext, issues: Issue[]): void {
  if (!ctx.resourceExists) return;
  if (!value.startsWith('/')) {
    issues.push({ severity: 'error', resource: '/game.project', line, message: `[${section}] ${key} must be an absolute resource path starting with "/".`, rule: 'setting-path' });
    return;
  }
  const compiledDefault = !!s.default && /c$/.test(s.default) && /\.[a-z_]+c$/.test(s.default);
  const source = compiledDefault && value.endsWith('c') ? value.slice(0, -1) : value;
  const exists = ctx.resourceExists(source);
  if (exists === false) {
    issues.push({
      severity: ctx.missingRefSeverity ?? 'error',
      resource: '/game.project',
      line,
      message: `[${section}] ${key} points to ${value}, but ${source} does not exist.`,
      rule: 'missing-resource',
    });
  } else if (compiledDefault && !value.endsWith('c') && exists === true) {
    issues.push({
      severity: 'warning',
      resource: '/game.project',
      line,
      message: `[${section}] ${key} should reference the compiled resource: ${value}c`,
      rule: 'compiled-path',
    });
  }
}
