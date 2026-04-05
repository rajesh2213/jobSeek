/** Strip common seniority / level prefixes from role title labels (display only). */
const SENIORITY_LEADING_CHUNK =
  /^(?:Head of|Director of|Senior|Lead|Principal|Staff|Junior|Associate|Sr\.?|Jr\.?)\s+/i;

export function stripRoleLabelSeniority(raw: string): string {
  let s = raw.trim().replace(/\s+/g, " ");
  if (!s) return raw.trim();
  for (;;) {
    const next = s.replace(SENIORITY_LEADING_CHUNK, "").trim();
    if (next === s) break;
    s = next;
  }
  return s || raw.trim();
}

export function mergeRoleSuggestionsByDisplay(
  rows: Array<{ slug: string; label: string; count: number }>,
): Array<{ slug: string; label: string; count: number }> {
  const groups = new Map<string, Array<{ slug: string; label: string; count: number }>>();
  for (const row of rows) {
    const label = stripRoleLabelSeniority(row.label);
    const key = label.toLowerCase().replace(/\s+/g, " ").trim() || row.slug;
    const list = groups.get(key) ?? [];
    list.push({ slug: row.slug, label, count: row.count });
    groups.set(key, list);
  }
  const out: Array<{ slug: string; label: string; count: number }> = [];
  for (const [, members] of groups) {
    const count = members.reduce((acc, m) => acc + m.count, 0);
    const winner = members.reduce((a, b) => (b.count > a.count ? b : a));
    out.push({ slug: winner.slug, label: winner.label, count });
  }
  out.sort((a, b) => b.count - a.count);
  return out.slice(0, 30);
}
