import { defineTool } from './registry.js';
import { logsInput } from './schemas.js';
import { notYet } from './_stub.js';

export const logsTool = defineTool({
  name: 'logs',
  title: 'Defold game logs',
  description:
    `Read the running (or last) game's log output: print/pprint output, engine messages and Lua errors with file:line and tracebacks. Use cursor from the previous call to get only new lines; level=error to see only problems.`,
  inputSchema: logsInput,
  annotations: { readOnlyHint: true },
  handler: notYet('M1'),
});
