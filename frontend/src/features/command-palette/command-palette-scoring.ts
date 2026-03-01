/** Score how well `text` matches a search `term`. Higher = better. 0 = no match. */
export function scoreMatch(text: string, term: string): number {
  const lower = text.toLowerCase();
  if (lower === term) return 100;
  if (lower.startsWith(term)) return 80;
  // Word boundary match (e.g. "cron" matches "my-cron-job")
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\b${escaped}`).test(lower)) return 70;
  if (lower.includes(term)) return 60;
  return 0;
}

/** Score a command against multiple search terms. All terms must match. */
export function scoreCommand(
  cmd: { label: string; description?: string; keywords?: string[] },
  terms: string[],
): number {
  let total = 0;
  for (const term of terms) {
    const labelScore = scoreMatch(cmd.label, term);
    const descScore = scoreMatch(cmd.description ?? '', term) * 0.8;
    const kwScores = (cmd.keywords ?? []).map((kw) => scoreMatch(kw, term) * 0.9);
    const best = Math.max(labelScore, descScore, ...kwScores);
    if (best === 0) return 0; // every term must match somewhere
    total += best;
  }
  return total;
}
