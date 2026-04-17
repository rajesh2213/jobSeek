import type { ConfidenceLevel, ExperienceEntry, ResumeSections } from "../types.js";
import { computeDurationYears, parseDateRange } from "../utils/normalizers.js";

const DATE_RANGE_RE =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\s*(?:-|–|—|to)\s*(?:present|current|now|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}|\d{4})|\b(19\d{2}|20\d{2}|21\d{2})\s*(?:-|–|—|to)\s*(present|current|now|19\d{2}|20\d{2}|21\d{2})/i;
const BULLET_RE = /^[•\-–—▪▸►✓✔*]\s*/;

function clean(lines: string[]): string[] {
  return lines.map((l) => l.trim()).filter(Boolean);
}

function isDateRange(line: string): boolean {
  return DATE_RANGE_RE.test(line);
}

function looksRoleLike(line: string): boolean {
  if (line.length < 4 || line.length > 120) return false;
  if (/@|https?:\/\//i.test(line)) return false;
  return /\b(engineer|developer|manager|analyst|consultant|architect|intern|lead|specialist|director)\b/i.test(
    line,
  );
}

function splitBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let cur: string[] = [];

  for (const line of lines) {
    if (cur.length === 0) {
      cur.push(line);
      continue;
    }
    const hasDate = cur.some(isDateRange);
    if (isDateRange(line) && hasDate) {
      blocks.push(cur);
      cur = [line];
      continue;
    }
    if (looksRoleLike(line) && cur.length >= 4 && hasDate) {
      blocks.push(cur);
      cur = [line];
      continue;
    }
    cur.push(line);
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

function parseBlock(lines: string[]): ExperienceEntry {
  const entry: ExperienceEntry = { bullets: [] };
  const nonBullet = lines.filter((l) => !BULLET_RE.test(l));
  const dateLine = nonBullet.find(isDateRange);
  const core = nonBullet.filter((l) => !isDateRange(l));

  if (core[0]) entry.role = core[0].slice(0, 200);
  if (core[1]) entry.company = core[1].slice(0, 200);

  if (dateLine) {
    const d = parseDateRange(dateLine);
    entry.startDate = d.startDate;
    entry.endDate = d.endDate;
    entry.durationYears = computeDurationYears(entry.startDate, entry.endDate);
  }

  const bullets = lines
    .filter((l) => BULLET_RE.test(l) || (!isDateRange(l) && l !== core[0] && l !== core[1]))
    .map((l) => l.replace(BULLET_RE, "").trim())
    .filter(Boolean);
  entry.bullets = bullets.slice(0, 20);

  return entry;
}

export function extractExperience(
  sections: ResumeSections,
): { experience: ExperienceEntry[]; confidence: Record<string, ConfidenceLevel> } {
  const confidence: Record<string, ConfidenceLevel> = {};
  const lines = clean(sections.experience);
  if (lines.length === 0) return { experience: [], confidence };

  const blocks = splitBlocks(lines);
  const entries = blocks
    .map(parseBlock)
    .filter((e) => Boolean(e.role || e.company || e.startDate || e.endDate || e.bullets.length))
    .slice(0, 20);

  if (entries.length > 0) {
    const strong = entries.some((e) => e.role && e.company && (e.startDate || e.endDate));
    confidence.experience = strong ? "high" : "medium";
  }
  return { experience: entries, confidence };
}
