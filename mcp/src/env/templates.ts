// The Defold editor's "New file" templates (jar: templates/template.<ext>), used when creating resources.
import path from 'node:path';
import type { DefoldInstall } from './locate.js';
import { readBuiltin } from './builtins.js';

export async function editorTemplate(install: DefoldInstall | undefined, resourcePath: string): Promise<string | undefined> {
  if (!install?.jarPath) return undefined;
  const ext = resourcePath.slice(resourcePath.lastIndexOf('.') + 1);
  let text: string;
  try {
    text = await readBuiltin(install, `templates/template.${ext}`);
  } catch {
    return undefined;
  }
  const name = path.basename(resourcePath).replace(/\.[^.]+$/, '');
  return text.replace(/\r\n/g, '\n').replace(/\{\{NAME\}\}/g, name);
}
