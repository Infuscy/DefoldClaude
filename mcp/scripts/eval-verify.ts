// Build and run the projects that eval agents produced, the same way for both arms, because `claude plugin eval`
// graders cannot run a build (and only the plugin arm has build tools). Expectations per case live in
// plugins/defold/evals/<case>/verify.json: { "run_seconds": 3, "expect_log": ["collected"] }.
//
//   claude plugin eval plugins/defold --tag project --keep-temp ... --json result.json
//   npx tsx scripts/eval-verify.ts result.json [--out <dir>] [--cleanup]
//   npx tsx scripts/eval-verify.ts --project <dir> --case <name> [--screenshot <file.png>]
//
// Projects are copied out of the eval temp folders first (the eval tool warns they hold agent-written files).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, '../../plugins/defold/dist/server.mjs');
const evalsDir = path.resolve(here, '../../plugins/defold/evals');

interface Expectations {
  run_seconds?: number;
  expect_log?: string[];
  /** RGB that must appear somewhere in a game screenshot (e.g. the colour of a sprite that should be visible). */
  expect_color?: [number, number, number];
}
interface Outcome {
  built: boolean;
  luaErrors: number;
  missingLogs: string[];
  colorSeen?: boolean;
  detail: string;
}

function hasColor(pngData: Buffer, [r, g, b]: [number, number, number]): boolean {
  const img = PNG.sync.read(pngData);
  for (let i = 0; i < img.data.length; i += 4) {
    if (Math.abs(img.data[i]! - r) + Math.abs(img.data[i + 1]! - g) + Math.abs(img.data[i + 2]! - b) < 40) return true;
  }
  return false;
}

function expectationsFor(caseName: string): Expectations | undefined {
  const file = path.join(evalsDir, caseName, 'verify.json');
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Expectations) : undefined;
}

async function checkProject(dir: string, exp: Expectations, screenshot?: string): Promise<Outcome> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.DEFOLD_PROJECT_DIR = dir;
  const client = new Client({ name: 'defold-eval-verify', version: '0.0.1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: 'ignore' }));
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const blocks = res.content as Array<{ type: string; text?: string; data?: string }>;
    return { text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n'), image: blocks.find((b) => b.type === 'image')?.data };
  };
  try {
    const build = await call('build');
    if (!/succeeded/.test(build.text.split('\n')[0] ?? '')) {
      return { built: false, luaErrors: 0, missingLogs: exp.expect_log ?? [], detail: build.text.split('\n').slice(0, 4).join(' | ') };
    }
    const run = await call('run', { wait_seconds: exp.run_seconds ?? 3 });
    const logs = await call('logs', { max_lines: 500 });
    let colorSeen: boolean | undefined;
    if (screenshot || exp.expect_color) {
      const shot = await call('screenshot', { max_size: 512 });
      const image = shot.image ? Buffer.from(shot.image, 'base64') : undefined;
      if (image && screenshot) fs.writeFileSync(screenshot, image);
      if (exp.expect_color) colorSeen = !!image && hasColor(image, exp.expect_color);
    }
    await call('run', { action: 'stop' });
    const all = `${run.text}\n${logs.text}`;
    const counts = [...all.matchAll(/Lua errors[^(\n]*\((\d+)\)/g)].map((m) => Number(m[1]));
    const luaErrors = counts.length ? Math.max(...counts) : 0;
    const firstError = /^- (.+)$/m.exec(all.slice(all.search(/Lua errors[^(\n]*\(/)))?.[1];
    return {
      built: true,
      luaErrors,
      missingLogs: (exp.expect_log ?? []).filter((s) => !all.includes(s)),
      colorSeen,
      detail: luaErrors && firstError ? firstError.slice(0, 160) : '',
    };
  } finally {
    await client.close();
  }
}

function copyProject(src: string, dest: string): void {
  fs.rmSync(dest, { recursive: true, force: true });
  const skip = new Set(['.git', '.claude', '.internal', 'build']);
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (p) => !skip.has(path.basename(p)) && !fs.lstatSync(p).isSymbolicLink(),
  });
}

const verdict = (exp: Expectations, o: Outcome) => (o.built && o.luaErrors === 0 && !o.missingLogs.length && o.colorSeen !== false ? 'PASS' : 'FAIL');
const row = (name: string, exp: Expectations, o: Outcome) =>
  `${name.padEnd(34)} ${verdict(exp, o)}  build=${o.built ? 'ok' : 'FAILED'} lua_errors=${o.luaErrors}` +
  `${o.missingLogs.length ? ` missing_log=${JSON.stringify(o.missingLogs)}` : ''}${o.colorSeen === false ? ` color_not_on_screen=${JSON.stringify(exp.expect_color)}` : ''}` +
  `${o.detail ? `\n${' '.repeat(36)}${o.detail}` : ''}`;

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (opt('--project')) {
  const caseName = opt('--case') ?? '';
  const exp = expectationsFor(caseName) ?? {};
  console.log(row(caseName || path.basename(opt('--project')!), exp, await checkProject(path.resolve(opt('--project')!), exp, opt('--screenshot'))));
} else {
  const resultFile = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out');
  if (!resultFile) throw new Error('usage: eval-verify.ts <eval-result.json> [--out <dir>] [--cleanup]');
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as {
    cases: Array<{ name: string; arms: Record<string, Array<{ tracePath: string }>> }>;
  };
  const out = path.resolve(opt('--out') ?? path.join(os.tmpdir(), 'defold-eval-verify'));
  for (const c of result.cases) {
    const exp = expectationsFor(c.name);
    if (!exp) continue;
    for (const [arm, runs] of Object.entries(c.arms)) {
      for (const [i, run] of runs.entries()) {
        const root = path.dirname(path.dirname(run.tracePath));
        const src = path.join(root, 'home', 'cwd');
        const name = `${c.name}-${arm}${runs.length > 1 ? `-${i + 1}` : ''}`;
        if (!fs.existsSync(src)) {
          console.log(`${name.padEnd(34)} SKIP  (no kept project; run the eval with --keep-temp)`);
          continue;
        }
        const dest = path.join(out, name);
        copyProject(src, dest);
        if (args.includes('--cleanup') && path.basename(root).startsWith('claude-eval-')) fs.rmSync(root, { recursive: true, force: true });
        console.log(row(name, exp, await checkProject(dest, exp, path.join(out, `${name}.png`))));
      }
    }
  }
  console.log(`\nProjects and screenshots: ${out}`);
}
