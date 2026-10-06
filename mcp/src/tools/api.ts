import { findExact, loadApiIndex, loadProjectApis, renderBrief, renderFull, searchApi, type ApiElement } from '../docs/apiIndex.js';
import { tryResolveProject } from '../env/project.js';
import { requireInstall } from './common.js';
import { defineTool } from './registry.js';
import { errorResult, textResult } from './result.js';
import { apiInput } from './schemas.js';

export const apiTool = defineTool({
  name: 'api',
  title: 'Defold API reference',
  description:
    `Look up the Lua API of the installed Defold version: functions, messages, properties and constants for go, msg, gui, vmath, physics, sprite, factory, sys, render, sound, timer, editor (editor scripts) and more, plus APIs of native extensions used by the project. name=go.animate returns the full signature, parameters, return values and examples; query searches.`,
  inputSchema: apiInput,
  annotations: { readOnlyHint: true },
  async handler(args) {
    if (!args.name && !args.query && !args.namespace) return errorResult('Pass "name" (exact element), "query" (search) or "namespace" (list).');
    const install = requireInstall();
    let elements: ApiElement[] = await loadApiIndex(install);
    const project = tryResolveProject(args.project);
    if (project) elements = elements.concat(await loadProjectApis(project));

    if (args.name) {
      const hits = findExact(elements, args.name, args.environment === 'runtime' ? 'all' : args.environment);
      if (hits.length) {
        const text = hits.slice(0, 4).map(renderFull).join('\n\n---\n\n');
        return textResult(`${text}\n\n(Defold ${install.version ?? ''} API)`, { found: hits.length, names: hits.map((h) => h.name) });
      }
      // Search the words of the unknown name; keep a namespace prefix (go.move_to → namespace go, "move to").
      const dot = args.name.indexOf('.');
      const nsGuess = dot > 0 ? args.name.slice(0, dot) : undefined;
      const knownNs = nsGuess && elements.some((e) => e.namespace === nsGuess) ? nsGuess : undefined;
      const words = (knownNs ? args.name.slice(dot + 1) : args.name).replace(/[._:]/g, ' ');
      let similar = searchApi(elements, words, { namespace: knownNs, environment: 'all', limit: 6 });
      if (!similar.length) similar = searchApi(elements, words, { environment: 'all', limit: 6 });
      return textResult(
        `No API element named "${args.name}" in Defold ${install.version ?? ''}. It probably does not exist.` +
          (similar.length ? `\nClosest matches:\n${similar.map((e) => `- ${renderBrief(e)}`).join('\n')}` : ''),
        { found: 0 },
      );
    }

    if (!args.query && args.namespace) {
      const ns = args.namespace.toLowerCase();
      const members = elements
        .filter((e) => e.namespace.toLowerCase() === ns && (args.environment === 'all' || e.environment === args.environment))
        .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
      if (!members.length) return textResult(`No namespace "${args.namespace}". Known: ${[...new Set(elements.map((e) => e.namespace))].sort().join(', ')}`);
      return textResult(`${members.length} entries in ${args.namespace}:\n${members.map((e) => `- ${renderBrief(e)}`).join('\n')}`);
    }

    const hits = searchApi(elements, args.query ?? '', { namespace: args.namespace, environment: args.environment, limit: args.limit });
    if (!hits.length) return textResult(`No API matches for "${args.query}". Try the docs tool for concepts.`);
    const top = hits[0]!;
    const detail = hits.length && (top.name.toLowerCase() === (args.query ?? '').toLowerCase() || hits.length === 1) ? `\n\n${renderFull(top)}` : '';
    return textResult(`${hits.length} match(es) for "${args.query}":\n${hits.map((e) => `- ${renderBrief(e)}`).join('\n')}${detail}\n\nUse name=<element> for full details.`, {
      names: hits.map((h) => h.name),
    });
  },
});
