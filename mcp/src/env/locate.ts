import fs from 'node:fs';
import path from 'node:path';
import { isDir, isFile, readJsonSync, readTextSync } from '../util/fsx.js';
import { interpolateIni, parseIni } from '../util/ini.js';
import { commonInstallDirs, defoldSupportDirs, exeSuffix, hostPlatform, usableEnv } from './platform.js';

export interface DefoldInstall {
  /** Directory holding the editor `config` file and `packages/` (resources path). */
  root: string;
  version?: string;
  sha1?: string;
  channel?: string;
  /** Java executable bundled with the editor (or from JAVA_HOME in bob-only mode). */
  javaPath?: string;
  /** Jar that contains com.dynamo.bob.Bob (editor jar, or a standalone bob.jar). */
  jarPath?: string;
  /** Editor launcher (Defold.exe / Defold.app / Defold). */
  editorExe?: string;
  /** Editor unpack directory for this sha1 (contains dmengine, LuaLS, annotations) if the editor has run. */
  unpackDir?: string;
  /** How the install was found. */
  source: 'env' | 'installations.json' | 'common-location' | 'bob-jar';
  problems: string[];
}

export interface LocateResult {
  install?: DefoldInstall;
  /** Human-readable trail of what was checked; shown by the status tool when nothing is found. */
  searched: string[];
}

let cached: LocateResult | undefined;

export function locateDefold(options: { refresh?: boolean } = {}): LocateResult {
  if (cached && !options.refresh) return cached;
  const searched: string[] = [];
  const tryRoot = (dir: string, source: DefoldInstall['source']): DefoldInstall | undefined => {
    const root = normalizeInstallDir(dir);
    searched.push(`${source}: ${root}`);
    if (!root || !isFile(path.join(root, 'config'))) return undefined;
    return readInstall(root, source);
  };

  let install: DefoldInstall | undefined;

  const envHome = process.env.DEFOLD_HOME;
  if (usableEnv(envHome)) install = tryRoot(envHome, 'env');

  if (!install) {
    for (const support of defoldSupportDirs()) {
      const file = path.join(support, 'installations.json');
      const list = readJsonSync<Array<{ installPath?: string; launcherPath?: string; lastLaunchedAt?: string }>>(file);
      if (!Array.isArray(list)) continue;
      const sorted = [...list].sort((a, b) => (b.lastLaunchedAt ?? '').localeCompare(a.lastLaunchedAt ?? ''));
      for (const entry of sorted) {
        const candidate = entry.installPath ?? (entry.launcherPath ? path.dirname(entry.launcherPath) : undefined);
        if (!candidate) continue;
        install = tryRoot(candidate, 'installations.json');
        if (install) break;
      }
      if (install) break;
    }
  }

  if (!install) {
    for (const dir of commonInstallDirs()) {
      install = tryRoot(dir, 'common-location');
      if (install) break;
    }
  }

  if (!install) {
    const bobJar = process.env.DEFOLD_BOB_JAR;
    if (usableEnv(bobJar) && isFile(bobJar)) {
      searched.push(`bob-jar: ${bobJar}`);
      install = readBobOnly(bobJar);
    }
  }

  cached = { install, searched };
  return cached;
}

/** Accept the install dir itself, a path to the launcher executable, or a macOS .app bundle. */
function normalizeInstallDir(dir: string): string {
  let p = dir.trim().replace(/^"|"$/g, '');
  if (!p) return p;
  if (isFile(p)) p = path.dirname(p);
  if (p.endsWith('.app') && isDir(path.join(p, 'Contents', 'Resources'))) p = path.join(p, 'Contents', 'Resources');
  return path.resolve(p);
}

function readInstall(root: string, source: DefoldInstall['source']): DefoldInstall {
  const problems: string[] = [];
  const doc = parseIni(readTextSync(path.join(root, 'config')) ?? '');
  const get = interpolateIni(doc, { 'bootstrap.resourcespath': root.replace(/\\/g, '/') });
  const version = get('build', 'version');
  const sha1 = get('build', 'editor_sha1') ?? get('build', 'engine_sha1');
  const channel = get('build', 'channel');

  let javaPath = get('launcher', 'java');
  if (javaPath) {
    javaPath = path.resolve(javaPath + (javaPath.endsWith(exeSuffix()) ? '' : exeSuffix()));
    if (!isFile(javaPath)) {
      problems.push(`Bundled Java not found at ${javaPath}`);
      javaPath = undefined;
    }
  }
  let jarPath = get('launcher', 'jar');
  if (jarPath) {
    jarPath = path.resolve(jarPath);
    if (!isFile(jarPath)) {
      problems.push(`Editor jar not found at ${jarPath}`);
      jarPath = undefined;
    }
  }
  if (!javaPath) {
    const fallback = javaFromEnv();
    if (fallback) javaPath = fallback;
  }

  const editorExe = findEditorExe(root);
  const unpackDir = sha1 ? findUnpackDir(sha1) : undefined;
  return { root, version, sha1, channel, javaPath, jarPath, editorExe, unpackDir, source, problems };
}

function readBobOnly(bobJar: string): DefoldInstall {
  const javaPath = javaFromEnv();
  const problems: string[] = [];
  if (!javaPath) problems.push('No Java found for bob.jar: set JAVA_HOME (bob needs OpenJDK 25 for Defold 1.13).');
  return { root: path.dirname(bobJar), jarPath: path.resolve(bobJar), javaPath, source: 'bob-jar', problems };
}

function javaFromEnv(): string | undefined {
  const home = process.env.JAVA_HOME;
  if (usableEnv(home)) {
    const p = path.join(home, 'bin', 'java' + exeSuffix());
    if (isFile(p)) return p;
  }
  return undefined;
}

function findEditorExe(root: string): string | undefined {
  const candidates =
    process.platform === 'win32'
      ? [path.join(root, 'Defold.exe')]
      : process.platform === 'darwin'
        ? [path.resolve(root, '..', '..')] // .../Defold.app
        : [path.join(root, 'Defold')];
  return candidates.find((c) => fs.existsSync(c));
}

/** The editor unpacks engine binaries and LuaLS into <support>/unpack/<sha1>-<arch>/. */
export function findUnpackDir(sha1: string): string | undefined {
  const override = process.env.DEFOLD_UNPACK_PATH;
  if (usableEnv(override) && isDir(override)) return override;
  for (const support of defoldSupportDirs()) {
    const unpackRoot = path.join(support, 'unpack');
    let names: string[] = [];
    try {
      names = fs.readdirSync(unpackRoot);
    } catch {
      continue;
    }
    const match = names.filter((n) => n.startsWith(sha1)).sort();
    for (const name of match) {
      const dir = path.join(unpackRoot, name);
      if (isDir(path.join(dir, hostPlatform()))) return dir;
    }
  }
  return undefined;
}

/** dmengine shipped in the editor unpack dir (exists once the editor has run this version). */
export function unpackedEngine(install: DefoldInstall): string | undefined {
  if (!install.unpackDir) return undefined;
  const p = path.join(install.unpackDir, hostPlatform(), 'bin', 'dmengine' + exeSuffix());
  return isFile(p) ? p : undefined;
}

export function describeInstall(install: DefoldInstall): string {
  const lines = [
    `Defold ${install.version ?? '?'}${install.channel ? ` (${install.channel})` : ''} sha1 ${install.sha1 ?? '?'}`,
    `  install: ${install.root} [found via ${install.source}]`,
    `  java:    ${install.javaPath ?? 'MISSING'}`,
    `  bob jar: ${install.jarPath ?? 'MISSING'}`,
    `  editor:  ${install.editorExe ?? 'not found'}`,
    `  unpack:  ${install.unpackDir ?? 'not present (engine will be extracted from the jar on first run)'}`,
  ];
  for (const p of install.problems) lines.push(`  problem: ${p}`);
  return lines.join('\n');
}
