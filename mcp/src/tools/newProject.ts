import path from 'node:path';
import { createFromTemplate, findTemplate, listTemplates } from '../env/projectTemplates.js';
import { requireInstall } from './common.js';
import { defineTool } from './registry.js';
import { errorResult, textResult } from './result.js';
import { newProjectInput } from './schemas.js';

export const newProjectTool = defineTool({
  name: 'new_project',
  title: 'New Defold project',
  description:
    `Create a new Defold project from an official template (empty, mobile, desktop, basic-3d, platformer, html5-poki, native-extension, rive, or a tutorial/sample) in an empty folder and set its title. The empty template works offline.`,
  inputSchema: newProjectInput,
  annotations: { readOnlyHint: false },
  async handler(args, ctx) {
    const install = requireInstall();
    const templates = await listTemplates(install);
    const template = findTemplate(templates, args.template);
    if (!template) {
      const byCat = new Map<string, string[]>();
      for (const t of templates) byCat.set(t.category, [...(byCat.get(t.category) ?? []), t.id]);
      return errorResult(`Unknown template "${args.template}". Available:\n${[...byCat].map(([c, ids]) => `- ${c}: ${ids.join(', ')}`).join('\n')}`);
    }
    const dest = path.resolve(args.directory);
    await ctx.progress(template.bundled ? 'Extracting the bundled template' : `Downloading ${template.zipUrl}`);
    const files = await createFromTemplate(install, template, dest, args.title);
    const title = args.title ?? '(template title)';
    return textResult(
      `Created ${template.category.replace(/s$/, '')} "${template.id}" in ${dest} (${files.length} files, title ${title}).\n` +
        `Next: build with project="${dest}", then open it in the Defold editor (File > Open Project) or run it with the run tool.`,
    );
  },
});
