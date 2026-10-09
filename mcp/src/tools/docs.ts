import { extractSection, findDoc, headingsOf, loadDocs, searchDocs, type DocSet, type DocSource } from '../docs/manuals.js';
import { defineTool } from './registry.js';
import { errorResult, pageText, textResult } from './result.js';
import { docsInput } from './schemas.js';

export const docsTool = defineTool({
  name: 'docs',
  title: 'Defold manuals and examples',
  description:
    `Search and read the official Defold manuals and examples (cached locally). action=list shows topics, search finds relevant sections, read returns a manual or example (optionally one section). Use for concepts and workflows; use the api tool for exact function signatures.`,
  inputSchema: docsInput,
  annotations: { readOnlyHint: true },
  async handler(args) {
    const sources: DocSource[] = args.source === 'all' ? ['manuals', 'examples'] : [args.source];
    const sets: DocSet[] = [];
    for (const s of sources) sets.push(await loadDocs(s));
    const staleNote = sets.some((s) => s.stale) ? '\n(Using a cached copy; defold.com could not be reached.)' : '';

    if (args.action === 'list') {
      const parts: string[] = [];
      for (const set of sets) {
        parts.push(`## ${set.source} (${set.entries.length})`);
        for (const c of set.categories) parts.push(`- ${c.name}: ${c.ids.join(', ')}`);
      }
      return textResult(parts.join('\n') + '\n\nRead one with action=read name=<id>.' + staleNote);
    }

    if (args.action === 'search') {
      if (!args.query) return errorResult('action=search needs "query".');
      const hits = searchDocs(sets, args.query, 8);
      if (!hits.length) return textResult(`Nothing found for "${args.query}".${staleNote}`);
      const lines = hits.map(
        (h) =>
          `- ${h.entry.source === 'manuals' ? 'manual' : 'example'} **${h.entry.id}** — ${h.entry.title}${h.entry.brief ? `: ${h.entry.brief}` : ''}` +
          (h.sections.length ? `\n  sections: ${h.sections.join(' | ')}` : '') +
          `\n  ${h.snippet}`,
      );
      return textResult(`${lines.join('\n')}\n\nRead with action=read name=<id> (optionally section=<heading>).${staleNote}`);
    }

    if (!args.name) return errorResult('action=read needs "name" (see action=list or search).');
    const doc = findDoc(sets, args.name);
    if (!doc) {
      const hits = searchDocs(sets, args.name, 5);
      return textResult(`No manual/example named "${args.name}".${hits.length ? ` Did you mean: ${hits.map((h) => h.entry.id).join(', ')}?` : ''}`);
    }
    let body = doc.text;
    if (args.section) {
      const sec = extractSection(doc.text, args.section);
      if (!sec) return textResult(`No section matching "${args.section}" in ${doc.id}. Sections:\n${headingsOf(doc.text).join('\n')}`);
      body = sec;
    }
    const page = pageText(body, args.offset, args.max_chars);
    const url = doc.source === 'manuals' ? `https://defold.com/manuals/${doc.id}/` : `https://defold.com/examples/${doc.id.replace(':', '/')}/`;
    const header = `# ${doc.title} (${doc.source === 'manuals' ? 'manual' : 'example'} ${doc.id}) — ${url}`;
    const more = page.nextOffset !== undefined ? `\n\n[continues — call again with offset=${page.nextOffset}]` : '';
    return textResult(`${header}\n\n${page.text}${more}${staleNote}`);
  },
});
