import fsp from 'node:fs/promises';
import path from 'node:path';
import { hostPlatform } from '../env/platform.js';
import { runBob, needsResolve } from '../runtime/bob.js';
import { editorBob, editorCommand } from '../runtime/editor.js';
import { AGENT_BUILD_DIR } from '../runtime/enginebin.js';
import { summarizeIssues, type Issue } from '../runtime/issues.js';
import { withLock } from '../runtime/processes.js';
import { chooseBackend, editorBuildCommand, requireInstall, requireProject } from './common.js';
import { defineTool } from './registry.js';
import { textResult } from './result.js';
import { buildInput } from './schemas.js';

export const buildTool = defineTool({
  name: 'build',
  title: 'Build Defold project',
  description:
    `Build the Defold project and return structured issues {severity, resource, line, message}. Uses the open Defold editor when it has the project open (fast, same results as the editor), otherwise bob headless into build/agent. command=resolve fetches library dependencies, clean removes build output, bundle creates a platform bundle (platform e.g. wasm-web, x86_64-win32, arm64-android).`,
  inputSchema: buildInput,
  annotations: { readOnlyHint: false },
  async handler(args, ctx) {
    const project = requireProject(args.project);
    const backend = await chooseBackend(project, args.backend);
    return withLock(`build:${project.root}`, async () => {
      const started = Date.now();
      let success = false;
      let issues: Issue[] = [];
      let detail = '';

      if (backend.kind === 'editor') {
        const conn = backend.conn;
        switch (args.command) {
          case 'build': {
            await ctx.progress('Compiling in the Defold editor');
            const r = await editorBuildCommand(project, conn, 'compile', { timeoutMs: args.timeout_seconds * 1000, signal: ctx.signal });
            ({ success, issues } = r);
            break;
          }
          case 'resolve': {
            await ctx.progress('Fetching libraries in the Defold editor');
            const r = await editorCommand(conn, 'fetch-libraries', { timeoutMs: args.timeout_seconds * 1000, signal: ctx.signal });
            success = r.success;
            issues = r.issues;
            const libs = (r.raw as { libraries?: Array<{ uri: string; success: boolean; message?: string }> }).libraries ?? [];
            for (const lib of libs) if (!lib.success) issues.push({ severity: 'error', message: `${lib.uri}: ${lib.message ?? 'failed'}` });
            detail = libs.length ? `${libs.length} librar${libs.length === 1 ? 'y' : 'ies'} checked.` : '';
            break;
          }
          case 'clean': {
            await ctx.progress('Clean build in the Defold editor');
            const r = await editorBuildCommand(project, conn, 'clean-build', { timeoutMs: args.timeout_seconds * 1000, signal: ctx.signal });
            ({ success, issues } = r);
            break;
          }
          case 'bundle': {
            const platform = args.platform ?? hostPlatform();
            const output = args.bundle_output ?? path.join(project.root, 'bundle', platform);
            await ctx.progress(`Bundling ${platform} through the Defold editor`);
            const r = await editorBob(
              conn,
              { platform, variant: args.variant, archive: true, 'bundle-output': output },
              ['resolve', 'build', 'bundle'],
              args.timeout_seconds * 1000,
            );
            ({ success, issues } = r);
            detail = success ? `Bundle written to ${output}` : '';
            break;
          }
        }
      } else {
        const install = requireInstall();
        const progress = (message: string, percent: number) => void ctx.progress(message, percent, 100);
        let commands: string[];
        let extra: Parameters<typeof runBob>[2] = { commands: [] };
        switch (args.command) {
          case 'build':
            commands = needsResolve(project) ? ['resolve', 'build'] : ['build'];
            extra = { commands, variant: args.variant };
            break;
          case 'resolve':
            extra = { commands: ['resolve'] };
            break;
          case 'clean':
            extra = { commands: ['distclean'] };
            break;
          case 'bundle': {
            const platform = args.platform ?? hostPlatform();
            const output = args.bundle_output ?? path.join(project.root, 'bundle', platform);
            await fsp.mkdir(output, { recursive: true });
            extra = { commands: ['resolve', 'build', 'bundle'], platform, variant: args.variant, archive: true, bundleOutput: output };
            detail = `Bundle output: ${output}`;
            break;
          }
        }
        const r = await runBob(install, project, { ...extra, timeoutMs: args.timeout_seconds * 1000, signal: ctx.signal, onProgress: progress });
        success = r.success;
        issues = r.issues;
        if (!success && !issues.length) detail = r.log.split('\n').slice(-20).join('\n');
      }

      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const via = backend.kind === 'editor' ? 'Defold editor' : `bob (output ${AGENT_BUILD_DIR})`;
      const header = `${args.command} ${success ? 'succeeded' : 'FAILED'} via ${via} in ${seconds}s.`;
      const text = [header, summarizeIssues(issues), detail].filter(Boolean).join('\n');
      const structured = { success, backend: backend.kind, command: args.command, issues, duration_s: Number(seconds) };
      // A failed build is a valid result (the issues are the answer), not a tool failure.
      return textResult(text, structured);
    });
  },
});
