import { errorResult } from './result.js';

/** Placeholder handler used while a tool is still being implemented. */
export function notYet(milestone: string) {
  return async () => errorResult(`This tool is not implemented yet (planned for ${milestone}).`);
}
