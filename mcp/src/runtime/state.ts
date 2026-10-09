// Shared runtime state (running engines, log buffers) — filled in by the run/logs tools.

export interface RuntimeSummary {
  text: string;
}

type SummaryProvider = () => RuntimeSummary | undefined;
const providers: SummaryProvider[] = [];

export function addRuntimeSummaryProvider(provider: SummaryProvider): void {
  providers.push(provider);
}

export function runtimeSummary(): RuntimeSummary | undefined {
  const parts = providers.map((p) => p()).filter((p): p is RuntimeSummary => !!p);
  if (!parts.length) return undefined;
  return {
    text: parts.map((p) => p.text).join('\n'),
  };
}
