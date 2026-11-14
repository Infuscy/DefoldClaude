import { compactLog, formatErrors } from '../runtime/logs.js';
import { requireProject } from './common.js';
import { defineTool } from './registry.js';
import { textResult } from './result.js';
import { currentSession } from './run.js';
import { logsInput } from './schemas.js';

export const logsTool = defineTool({
  name: 'logs',
  title: 'Defold game logs',
  description:
    `Read the running (or last) game's log output: print/pprint output, engine messages and errors with file:line and tracebacks. Repeated errors and identical consecutive lines are folded into one with a count. Ends with every distinct error in the range (Lua and engine errors, grouped by location and message, with counts), including errors whose lines have since left the log buffer. Use cursor from the previous call to get only new lines; level=error to see only problems. To read from a "log line N" mentioned in a report, pass cursor=N-1.`,
  inputSchema: logsInput,
  annotations: { readOnlyHint: true },
  async handler(args) {
    const project = requireProject(args.project);
    const session = await currentSession(project);
    if (!session) {
      return textResult('No game has been run for this project in this session (and none was found running from the Defold editor). Use run action=start, or run action=attach for a game started elsewhere.');
    }
    const { lines } = session.logs.query({ after: args.cursor, level: args.level, grep: args.grep, max: Number.POSITIVE_INFINITY });
    const entries = compactLog(lines);
    const truncated = entries.length > args.max_lines;
    const shown = truncated ? entries.slice(entries.length - args.max_lines) : entries;
    const folded = entries.length < lines.length ? `, ${entries.length} after folding repeats` : '';
    const state = session.exited ? `exited (code ${session.exited.code ?? '?'})` : 'running';
    const parts = [
      `Game ${state} via ${session.backend}. ${lines.length} line(s)${folded}${truncated ? ` (showing the last ${shown.length}; narrow with cursor/level/grep)` : ''}.`,
      shown.map((l) => l.text).join('\n'),
      formatErrors(session.logs.errors(args.cursor ?? 0), { scope: 'in this range', maxGroups: 15 }),
      `Next cursor: ${session.logs.cursor}`,
    ];
    return textResult(parts.filter(Boolean).join('\n\n'));
  },
});
