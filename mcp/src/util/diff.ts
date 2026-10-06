// Minimal line diff for reporting edits: common prefix/suffix trimmed, changed block shown with context.

export function lineDiff(before: string, after: string, context = 2, maxLines = 60): string {
  if (before === after) return '(no changes)';
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  const out: string[] = [];
  const from = Math.max(0, start - context);
  out.push(`@@ line ${start + 1} @@`);
  for (let i = from; i < start; i++) out.push(`  ${a[i]}`);
  for (let i = start; i <= endA; i++) out.push(`- ${a[i]}`);
  for (let i = start; i <= endB; i++) out.push(`+ ${b[i]}`);
  for (let i = endA + 1; i < Math.min(a.length, endA + 1 + context); i++) out.push(`  ${a[i]}`);
  if (out.length > maxLines) {
    const removed = endA - start + 1;
    const added = endB - start + 1;
    return [...out.slice(0, maxLines), `… (${removed} line(s) removed, ${added} added in total)`].join('\n');
  }
  return out.join('\n');
}
