// Minimal INI reader for game.project and the Defold editor `config` file.
// Keys keep their original spelling (game.project uses `dependencies#0`-style indexed keys).

export interface IniEntry {
  section: string;
  key: string;
  value: string;
  line: number; // 1-based
}

export interface IniDocument {
  entries: IniEntry[];
  sections: Map<string, Map<string, string>>;
  get(section: string, key: string): string | undefined;
}

export function parseIni(text: string): IniDocument {
  const entries: IniEntry[] = [];
  const sections = new Map<string, Map<string, string>>();
  let section = '';
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).trim();
      if (!sections.has(section)) sections.set(section, new Map());
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    entries.push({ section, key, value, line: i + 1 });
    if (!sections.has(section)) sections.set(section, new Map());
    sections.get(section)!.set(key, value);
  }
  return {
    entries,
    sections,
    get(sec: string, key: string) {
      return sections.get(sec)?.get(key);
    },
  };
}

/** Resolve `${section.key}` references (used by the editor `config` file). */
export function interpolateIni(doc: IniDocument, overrides: Record<string, string> = {}): (sec: string, key: string) => string | undefined {
  const resolve = (sec: string, key: string, depth = 0): string | undefined => {
    const full = `${sec}.${key}`;
    const rawValue = full in overrides ? overrides[full] : doc.get(sec, key);
    if (rawValue === undefined || depth > 10) return rawValue;
    return rawValue.replace(/\$\{([^}.]+)\.([^}]+)\}/g, (_m, s: string, k: string) => resolve(s, k, depth + 1) ?? '');
  };
  return (sec, key) => resolve(sec, key);
}

/** Collect `key#N` indexed values (e.g. project.dependencies#0..N) in index order. */
export function indexedValues(doc: IniDocument, section: string, key: string): string[] {
  const values: Array<[number, string]> = [];
  for (const e of doc.entries) {
    if (e.section !== section) continue;
    const m = /^(.*)#(\d+)$/.exec(e.key);
    if (m && m[1] === key) values.push([Number(m[2]), e.value]);
    else if (e.key === key && e.value) values.push([-1, e.value]);
  }
  return values.sort((a, b) => a[0] - b[0]).flatMap(([, v]) => v.split(',').map((s) => s.trim()).filter(Boolean));
}
