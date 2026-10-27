import { formatLuaError } from '../runtime/logs.js';
import { requireProject } from './common.js';
import { defineTool } from './registry.js';
import { textResult } from './result.js';
import { currentSession } from './run.js';
import { logsInput } from './schemas.js';

export const logsTool = defineTool({
  name: 'logs',
  title: 'Defold game logs',
  description:
    `Read the running (or last) game's log output: print/pprint output, engine messages and Lua errors with file:line and tracebacks. Use cursor from the previous call to get only new lines; level=error to see only problems.`,
  inputSchema: logsInput,
  annotations: { readOnlyHint: true },
  async handler(args) {
    const project = requireProject(args.project);
    const session = await currentSession(project);
    if (!session) {
      return textResult('No game has been run for this project in this session (and none was found running from the Defold editor). Use run action=start, or run action=attach for a game started elsewhere.');
    }
    const { lines, truncated } = session.logs.query({ after: args.cursor, level: args.level, grep: args.grep, max: args.max_lines });
    const errors = session.logs.luaErrors(args.cursor ?? 0);
    const state = session.exited ? `exited (code ${session.exited.code ?? '?'})` : 'running';
    const parts = [
      `Game ${state} via ${session.backend}. ${lines.length} line(s)${truncated ? ` (showing the last ${lines.length}; narrow with cursor/level/grep)` : ''}.`,
      lines.map((l) => l.text).join('\n'),
      errors.length ? `Lua errors in this range (${errors.length}):\n${errors.slice(-10).map((e) => `- ${formatLuaError(e)}`).join('\n')}` : '',
      `Next cursor: ${session.logs.cursor}`,
    ];
    return textResult(parts.filter(Boolean).join('\n\n'));
  },
});
