// Read /builtins/ resources from the Defold jar (kept open for the session; opening costs ~2 s).
import type { DefoldInstall } from './locate.js';
import { ZipFile } from './zip.js';
import { onShutdown } from '../runtime/lifecycle.js';

let jar: { path: string; zip: Promise<ZipFile> } | undefined;

export async function readBuiltin(install: DefoldInstall, resource: string): Promise<string> {
  if (!install.jarPath) throw new Error('No Defold jar available to read builtins from.');
  if (!jar || jar.path !== install.jarPath) {
    jar = { path: install.jarPath, zip: ZipFile.open(install.jarPath) };
  }
  const zip = await jar.zip;
  return zip.readText(resource.replace(/^\/+/, ''));
}

onShutdown(async () => {
  if (jar) (await jar.zip).close();
  jar = undefined;
});
