import fs from 'node:fs';
import path from 'node:path';
import { checkFile, isCheckable } from '../ddf/checkfile.js';
import { locateDefold } from '../env/locate.js';
import { loadLibraries, makeResourceChecker } from '../env/projectfs.js';
import { normalizeProjectPath, toResourcePath } from '../env/project.js';
import type { Issue } from '../runtime/issues.js';
import { formatIssue } from '../runtime/issues.js';
import { walkFiles } from '../util/fsx.js';
import { requireProject } from './common.js';
import { defineTool } from './registry.js';
import { textResult } from './result.js';
import { validateInput } from './schemas.js';

const SKIP = new Set(['build', '.internal', '.git', 'node_modules', 'bundle', '.vscode', '.idea']);

export const validateTool = defineTool({
  name: 'validate',
  title: 'Validate Defold project',
  description:
    `Check files or the whole project without building: Lua syntax and common Defold mistakes, scene file schema (unknown fields, wrong enum values, missing required fields), missing resource references, duplicate ids, GUI texture/font/layer names, and game.project keys. Faster than a build; run after larger edits.`,
  inputSchema: validateInput,
  annotations: { readOnlyHint: true },
  async handler(args) {
    const project = requireProject(args.project);
    const libs = await loadLibraries(project);
    const exists = makeResourceChecker(project, libs);
    const installedVersion = locateDefold().install?.version;

    const targets: string[] = [];
    if (args.paths?.length) {
      for (const p of args.paths) {
        const { file } = normalizeProjectPath(project, p);
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) targets.push(...(await walkFiles(file, SKIP)));
        else targets.push(file);
      }
    } else {
      targets.push(...(await walkFiles(project.root, SKIP)));
    }

    const issues: Issue[] = [];
    let checked = 0;
    for (const file of targets) {
      const resource = toResourcePath(project, file);
      if (!resource || !isCheckable(resource)) continue;
      let text: string;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        issues.push({ severity: 'error', resource, message: 'File not found' });
        continue;
      }
      checked++;
      issues.push(...checkFile(resource, text, { resourceExists: exists, installedVersion, thorough: true }));
    }

    const order = { error: 0, warning: 1, info: 2 } as const;
    issues.sort((a, b) => order[a.severity] - order[b.severity] || (a.resource ?? '').localeCompare(b.resource ?? '') || (a.line ?? 0) - (b.line ?? 0));
    const errors = issues.filter((i) => i.severity === 'error').length;
    const warnings = issues.filter((i) => i.severity === 'warning').length;
    const shown = issues.slice(0, args.max_issues);
    const header = `Checked ${checked} file(s) in ${path.basename(project.root)}: ${errors} error(s), ${warnings} warning(s), ${issues.length - errors - warnings} note(s).`;
    const body = shown.map((i) => `- ${formatIssue(i)}`).join('\n');
    const more = issues.length > shown.length ? `\n… ${issues.length - shown.length} more (raise max_issues or validate specific paths)` : '';
    return textResult(`${header}${body ? '\n' + body : ''}${more}`, { checked, errors, warnings, issues: shown });
  },
});
