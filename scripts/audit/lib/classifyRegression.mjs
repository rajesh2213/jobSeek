/**
 * Classify Phase1→Phase2 scorable→unavailable regressions.
 */

const NON_ENGLISH_RE =
  /[àáâãäåæçèéêëìíîïñòóôõöùúûüýÿœßąćęłńóśźżäöüß]|(?:\b(?:und|der|die|das|für|mit|bei|sich|eine|einer|vous|nous|avec|pour)\b)/i;

const CORRUPT_COMPANY_RE =
  /\b(?:cloudinary|workday|greenhouse|lever)\b/i;

export function nonEnglishScore(text) {
  const t = String(text || "");
  if (!t) return 0;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const latinExtended = (t.match(/[^\x00-\x7F]/g) || []).length;
  const nonEnHits = (t.match(NON_ENGLISH_RE) || []).length;
  return (latinExtended + nonEnHits * 3) / Math.max(words.length, 1);
}

export function classifyRegression({
  row,
  phase1,
  phase2,
  listPayload,
}) {
  const title = row.title ?? "";
  const desc = stripHtml(row.description);
  const preview = (listPayload.previewLines ?? []).join(" ");

  if (phase1.signalCount > 0 && phase2.signalCount === 0) {
    const p1sources = new Set(phase1.skills.map((s) => s.source));
    const p1canon = new Set(phase1.skills.map((s) => s.canonical));

    const p1hadGeneric = [...p1canon].some((c) =>
      /^(approach|combines|contributor|seeking|enablement|execution|business|design|technical|senior|individual|organization|workflows|efficiency|expertise|practical|scalable|optimization|integrations|automation)$/.test(
        c,
      ),
    );
    if (p1hadGeneric && (p1sources.has("sparse_requirement") || p1sources.has("sparse_responsibility"))) {
      return "strict_filter_regression";
    }

    if (p1sources.has("description_fallback") && !phase2.skills.some((s) => s.source === "description_fallback")) {
      return "description_fallback_regression";
    }

    if (p1sources.has("taxonomy") || p1sources.has("parsed_requirement")) {
      const lostTaxonomy = phase1.skills
        .filter((s) => s.source === "taxonomy" || s.source === "parsed_requirement")
        .map((s) => s.canonical);
      if (lostTaxonomy.length > 0) {
        return "ontology_regression";
      }
    }

    if (p1sources.has("role_hint") || p1sources.has("title_family")) {
      return "title_family_mismatch";
    }
  }

  if (nonEnglishScore(`${title} ${desc}`) > 0.08) {
    return "non_english";
  }

  if (desc.length > 0 && desc.length < 120) {
    return "corrupt_data";
  }

  if (
    row.company?.name &&
    CORRUPT_COMPANY_RE.test(desc) &&
    !CORRUPT_COMPANY_RE.test(row.company.name.toLowerCase())
  ) {
    return "corrupt_data";
  }

  if (!row.parsedDescription && desc.length > 100) {
    return "parser_gap";
  }

  return "other";
}

function stripHtml(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
