// Normalized build/validation issues shared by bob, the editor backend and the validator.

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  /** Defold resource path, e.g. /main/player.script (when known). */
  resource?: string;
  /** 1-based line (when known). */
  line?: number;
  /** 1-based column (when known). */
  column?: number;
  message: string;
  /** Short machine-readable rule id for validator findings. */
  rule?: string;
}

export function formatIssue(issue: Issue): string {
  const loc = issue.resource ? `${issue.resource}${issue.line ? `:${issue.line}${issue.column ? `:${issue.column}` : ''}` : ''}` : '';
  return `${issue.severity.toUpperCase()}${loc ? ` ${loc}` : ''}: ${issue.message}${issue.rule ? ` [${issue.rule}]` : ''}`;
}

export function summarizeIssues(issues: Issue[], max = 60): string {
  if (!issues.length) return 'No issues.';
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const lines = [`${errors} error(s), ${warnings} warning(s):`];
  for (const issue of issues.slice(0, max)) lines.push(`- ${formatIssue(issue)}`);
  if (issues.length > max) lines.push(`… ${issues.length - max} more`);
  return lines.join('\n');
}

/**
 * Parse bob's console output. Formats (Bob.java, Defold 1.13):
 *   ERROR <resource>[:<line>] <message>                    (task failures, after "The build failed for the following reasons:")
 *   ERROR: <resource>:<line>: '<message>'                  (native extension / multiple compile exceptions; also WARNING:/INFO:)
 *   SEVERE: <message>                                      (fatal exceptions)
 */
export function parseBobOutput(output: string): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const push = (i: Issue) => {
    const key = `${i.severity}|${i.resource}|${i.line}|${i.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(i);
  };
  const severe: string[] = [];
  const lines = output.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!.trimEnd();
    let m = /^(ERROR|WARNING|INFO): (\S.*?):(-?\d+): '(.*)'$/.exec(line);
    if (m) {
      push(withResource(sev(m[1]!), m[2]!, posLine(m[3]!), m[4]!));
      continue;
    }
    m = /^ERROR (\/\S+?)(?::(\d+))? (.*)$/.exec(line);
    if (m) {
      // Lua compiler errors repeat the location inside the message; keep the message readable.
      push(withResource('error', m[1]!, m[2] ? Number(m[2]) : undefined, m[3]!.replace(/^\S+?:\d+:\s*/, '')));
      continue;
    }
    m = /^(?:\S+\s+\S+\s+)?SEVERE:?\s+(.*?)\s*$/.exec(line);
    if (m && m[1]) {
      const msg = m[1];
      // Skip Java stack frames ("com.dynamo.bob.Project.build(Project.java:817)") and cause headers.
      if (!/^Cause:\d+:/.test(msg) && !/^at /.test(msg) && !/\([\w$.]+\.java(:\d+)?\)$/.test(msg) && !/^[\w$.]+\(Native Method\)$/.test(msg)) {
        severe.push(stripJavaException(msg));
      }
      continue;
    }
    m = /^ERROR! (.*)$/.exec(line);
    if (m) push({ severity: 'error', message: m[1]! });
  }
  // Fatal SEVERE messages usually repeat an ERROR line that already carries a location; keep only new ones.
  for (const msg of severe) {
    if (!issues.some((i) => i.message.includes(msg) || msg.includes(i.message))) push({ severity: 'error', message: msg });
  }
  return issues;
}

function withResource(severity: Severity, resource: string, line: number | undefined, message: string): Issue {
  const clean = stripJavaException(message);
  const r = res(resource);
  // Embedded components compile to build/<dir>/_generated_<hash>.<ext>; that path means nothing to the user.
  if (r && /\/_generated_[0-9a-f]+\./.test(r)) {
    return { severity, message: `${clean} (in an embedded component; check the collection/game object that embeds it)` };
  }
  return { severity, resource: r, line, message: clean };
}

function stripJavaException(message: string): string {
  return message.replace(/^(?:[a-z_][\w]*\.)+[A-Z][\w$]*(?:Exception|Error)(?:Error)?:\s*/, '').trim();
}

function sev(s: string): Severity {
  return s === 'ERROR' ? 'error' : s === 'WARNING' ? 'warning' : 'info';
}

function res(r: string): string | undefined {
  if (r === 'unspecified') return undefined;
  return r.startsWith('/') ? r : `/${r}`;
}

function posLine(s: string): number | undefined {
  const n = Number(s);
  return n > 0 ? n : undefined;
}

/** Strip bob progress noise ("  83% Reading classes") and JVM native-access warnings from a log. */
export function cleanBobLog(output: string): string {
  return output
    .split(/\r?\n/)
    .filter((l) => !/^\s*\d+% /.test(l) && !/^WARNING: (A restricted method|java\.lang\.System::load|Use --enable-native-access|Restricted methods)/.test(l))
    .join('\n')
    .trim();
}
