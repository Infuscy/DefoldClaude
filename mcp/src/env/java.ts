// Java for running bob outside the editor (which bundles its own JDK): where it is, which version, which one bob needs.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { isFile } from '../util/fsx.js';
import { exeSuffix, usableEnv } from './platform.js';
import { ZipFile } from './zip.js';

/** JAVA_HOME first, then `java` on PATH. */
export function findJava(): string | undefined {
  const home = process.env.JAVA_HOME;
  if (usableEnv(home)) {
    const p = path.join(home, 'bin', 'java' + exeSuffix());
    if (isFile(p)) return p;
  }
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir.replace(/^"|"$/g, ''), 'java' + exeSuffix());
    if (isFile(p)) return p;
  }
  return undefined;
}

const majors = new Map<string, number | undefined>();

/** Major version of a java executable (8 for 1.8.0_x), from `java -version`. */
export function javaMajor(javaPath: string): number | undefined {
  if (majors.has(javaPath)) return majors.get(javaPath);
  const r = spawnSync(javaPath, ['-version'], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
  const major = parseJavaVersion(`${r.stderr ?? ''}\n${r.stdout ?? ''}`);
  majors.set(javaPath, major);
  return major;
}

export function parseJavaVersion(output: string): number | undefined {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(output);
  if (!m) return undefined;
  return m[1] === '1' && m[2] ? Number(m[2]) : Number(m[1]);
}

const required = new Map<string, number | undefined>();

/** The Java version bob was compiled for: class file major version of com.dynamo.bob.Bob minus 44 (69 → Java 25). */
export async function requiredJava(jarPath: string): Promise<number | undefined> {
  if (required.has(jarPath)) return required.get(jarPath);
  let version: number | undefined;
  try {
    const zip = await ZipFile.open(jarPath);
    try {
      if (zip.has('com/dynamo/bob/Bob.class')) version = classFileJava(await zip.read('com/dynamo/bob/Bob.class'));
    } finally {
      zip.close();
    }
  } catch {
    version = undefined;
  }
  required.set(jarPath, version);
  return version;
}

export function classFileJava(cls: Buffer): number | undefined {
  if (cls.length < 8 || cls.readUInt32BE(0) !== 0xcafebabe) return undefined;
  return cls.readUInt16BE(6) - 44;
}

/** Why bob cannot run with this Java, or undefined when it can (or the requirement is unknown). */
export async function javaProblem(javaPath: string | undefined, jarPath: string | undefined, defoldVersion?: string): Promise<string | undefined> {
  const need = jarPath ? await requiredJava(jarPath) : undefined;
  const what = `bob${defoldVersion ? ` for Defold ${defoldVersion}` : ''}`;
  const install = `Install a JDK${need ? ` ${need}` : ''} (for example Eclipse Temurin from https://adoptium.net) and set JAVA_HOME to it, or put its bin folder on PATH.`;
  if (!javaPath) return `No Java found: ${what} needs Java${need ? ` ${need} or newer` : ''}. ${install}`;
  if (!need) return undefined;
  const have = javaMajor(javaPath);
  if (have === undefined) return `Could not run ${javaPath} -version. ${install}`;
  if (have < need) return `${what} needs Java ${need} or newer, but ${javaPath} is Java ${have}. ${install}`;
  return undefined;
}
