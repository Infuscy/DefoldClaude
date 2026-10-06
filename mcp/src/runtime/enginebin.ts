import fs from 'node:fs';
import path from 'node:path';
import { type DefoldInstall, unpackedEngine } from '../env/locate.js';
import { cacheRoot, exeSuffix, hostPlatform } from '../env/platform.js';
import { ZipFile } from '../env/zip.js';
import { isFile } from '../util/fsx.js';
import { logInfo } from '../util/log.js';

export const AGENT_BUILD_DIR = 'build/agent';

/**
 * The dmengine executable to run for a project:
 * 1. a custom engine bob built for native extensions (build/agent/<platform>/dmengine),
 * 2. the editor's unpacked engine for this sha1,
 * 3. the engine extracted from the editor/bob jar into the plugin cache.
 */
export async function resolveEngineBinary(install: DefoldInstall, projectRoot: string): Promise<string> {
  const exe = 'dmengine' + exeSuffix();
  const custom = path.join(projectRoot, ...AGENT_BUILD_DIR.split('/'), hostPlatform(), exe);
  if (isFile(custom)) return custom;

  const unpacked = unpackedEngine(install);
  if (unpacked) return unpacked;

  if (!install.jarPath) throw new Error('No Defold engine found: the editor jar is missing. Check the status tool.');
  const dest = path.join(cacheRoot(), 'engine', install.sha1 ?? 'unknown', hostPlatform(), exe);
  if (isFile(dest)) return dest;
  logInfo(`extracting ${exe} from ${install.jarPath}`);
  const zip = await ZipFile.open(install.jarPath);
  try {
    const entry = `libexec/${hostPlatform()}/${exe}`;
    if (!zip.has(entry)) throw new Error(`The Defold jar has no engine for ${hostPlatform()} (${entry}).`);
    await zip.extract(entry, dest, 0o755);
  } finally {
    zip.close();
  }
  if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
  return dest;
}
