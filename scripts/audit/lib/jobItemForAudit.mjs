/** Build JobItem shapes for audit scripts (list vs detail). */

export function emptyParsed() {
  return {
    position: [],
    responsibility: [],
    requirement: [],
    experience: [],
    benefit: [],
    contact: [],
    other: [],
  };
}

export function stripHtml(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildPreviewLines(row) {
  if (row.description?.trim()) {
    const t = stripHtml(row.description);
    if (t.length >= 40) {
      return [t.slice(0, Math.min(280, t.length))];
    }
  }
  return [];
}

export function toListJobItem(row) {
  const preview = buildPreviewLines(row);
  return {
    id: row.id,
    title: row.title ?? "",
    role: row.role ?? "",
    category: row.category ?? "other",
    description: preview.length >= 40 ? null : row.description ?? "",
    previewLines: preview,
    skills: row.skills ?? [],
    parsedDescription: undefined,
    enriched: undefined,
    company: { id: row.companyId ?? "x", name: "x", slug: "x" },
    location: "x",
    country: row.country ?? "x",
    isRemote: row.isRemote ?? false,
    workMode: "onsite",
    employmentType: "full_time",
    postedAt: row.postedAt?.toISOString?.() ?? null,
  };
}

export function toDetailJobItem(row) {
  const preview = buildPreviewLines(row);
  return {
    ...toListJobItem(row),
    description: row.description ?? "",
    parsedDescription: row.parsedDescription ?? emptyParsed(),
    previewLines: preview,
  };
}

export function toListJobWithParsed(row) {
  return {
    ...toListJobItem(row),
    parsedDescription: row.parsedDescription ?? null,
    role: row.role ?? "",
  };
}

export function slimParsed(pd) {
  if (!pd || typeof pd !== "object") return null;
  return {
    position: [],
    responsibility: (pd.responsibility ?? []).slice(0, 8),
    requirement: (pd.requirement ?? []).slice(0, 8),
    experience: [],
    benefit: [],
    contact: [],
    other: [],
  };
}

export function toListJobSlimParsed(row) {
  return {
    ...toListJobItem(row),
    parsedDescription: slimParsed(row.parsedDescription),
    role: row.role ?? "",
  };
}
