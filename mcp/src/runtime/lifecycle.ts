// Cleanup hooks run when the MCP server shuts down (stop engines we started, close sockets).

type Cleanup = () => Promise<void> | void;
const cleanups: Cleanup[] = [];

export function onShutdown(fn: Cleanup): void {
  cleanups.push(fn);
}

export async function shutdownRuntime(): Promise<void> {
  for (const fn of cleanups.splice(0)) {
    try {
      await fn();
    } catch {
      // keep going
    }
  }
}
