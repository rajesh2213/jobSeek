import type { ConfidenceLevel, ResumeSections } from "../types.js";

function clean(lines: string[]): string[] {
  return lines.map((l) => l.trim()).filter(Boolean);
}

function dropContactNoise(lines: string[]): string[] {
  return lines.filter(
    (l) =>
      !/@|https?:\/\/|www\.|linkedin|github|portfolio/i.test(l) &&
      !/^\+?\d[\d()\s.-]{7,}\d$/.test(l) &&
      l.length > 20,
  );
}

export function extractSummary(
  text: string,
  sections: ResumeSections,
): { summary?: string; confidence: Record<string, ConfidenceLevel> } {
  const confidence: Record<string, ConfidenceLevel> = {};
  const summaryLines = clean(sections.summary);
  if (summaryLines.length > 0) {
    const s = summaryLines.slice(0, 5).join(" ").slice(0, 1200).trim();
    if (s) {
      confidence.summary = "high";
      return { summary: s, confidence };
    }
  }

  const fallback = dropContactNoise(clean(text.split("\n")));
  if (fallback.length > 0) {
    const s = fallback.slice(0, 4).join(" ").slice(0, 1200).trim();
    if (s) {
      confidence.summary = "medium";
      return { summary: s, confidence };
    }
  }
  return { confidence };
}
