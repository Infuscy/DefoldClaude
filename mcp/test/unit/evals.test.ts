import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// `claude plugin eval` silently skips a case whose prompt or grader frontmatter does not parse
// (e.g. "\d" inside a double-quoted YAML string), so check them all here.
const EVALS = path.resolve(import.meta.dirname, '../../../plugins/defold/evals');

function frontmatter(file: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(file, 'utf8'));
  if (!m) throw new Error(`${file}: no frontmatter`);
  return parse(m[1]!) as Record<string, unknown>;
}

const files = fs
  .readdirSync(EVALS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && d.name !== 'results')
  .flatMap((d) => {
    const dir = path.join(EVALS, d.name);
    const graders = path.join(dir, 'graders');
    return [path.join(dir, 'prompt.md'), ...fs.readdirSync(graders).map((f) => path.join(graders, f))];
  });

describe('eval suite files', () => {
  it.each(files.map((f) => [path.relative(EVALS, f), f]))('%s parses', (_name, file) => {
    const fm = frontmatter(file);
    if (typeof fm.pattern === 'string') expect(() => new RegExp(fm.pattern as string)).not.toThrow();
  });
});
