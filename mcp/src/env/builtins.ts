// Read /builtins/ resources from the Defold jar (kept open for the session; opening costs ~2 s).
import type { DefoldInstall } from './locate.js';
import { ZipFile } from './zip.js';
import { onShutdown } from '../runtime/lifecycle.js';

let jar: { path: string; zip: Promise<ZipFile> } | undefined;

/** The editor jar, opened once per session and shared. */
export async function openJar(install: DefoldInstall): Promise<ZipFile> {
  if (!install.jarPath) throw new Error('No Defold jar available.');
  if (!jar || jar.path !== install.jarPath) {
    jar = { path: install.jarPath, zip: ZipFile.open(install.jarPath) };
  }
  return jar.zip;
}

export async function readBuiltin(install: DefoldInstall, resource: string): Promise<string> {
  const zip = await openJar(install);
  return zip.readText(resource.replace(/^\/+/, ''));
}

onShutdown(async () => {
  if (jar) (await jar.zip).close();
  jar = undefined;
});
