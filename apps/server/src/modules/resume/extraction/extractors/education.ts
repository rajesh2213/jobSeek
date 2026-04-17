import type { ConfidenceLevel, EducationEntry, ResumeSections } from "../types.js";
import { parseDateRange } from "../utils/normalizers.js";

const DEGREE_RE =
  /\b(bachelor|master|phd|doctorate|b\.s\.|m\.s\.|b\.e\.|m\.e\.|b\.tech|m\.tech|mba|degree|diploma)\b/i;
const UNIVERSITY_RE = /\b(university|college|institute|school)\b/i;
const COURSE_RE =
  /\b(computer science|information technology|electronics|mechanical|civil|data science|ai|artificial intelligence|business administration)\b/i;
const CGPA_RE = /\b(?:cgpa|gpa)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?(?:\/[0-9]+(?:\.[0-9]+)?)?)\b/i;
const DATE_HINT_RE =
  /\b(19\d{2}|20\d{2}|21\d{2})\b|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

function clean(lines: string[]): string[] {
  return lines.map((l) => l.trim()).filter(Boolean);
}

function looksLikeEducationStart(line: string): boolean {
  return DEGREE_RE.test(line) || UNIVERSITY_RE.test(line);
}

function splitBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if (cur.length === 0) {
      cur.push(line);
      continue;
    }
    if (looksLikeEducationStart(line) && cur.some((x) => looksLikeEducationStart(x) || DATE_HINT_RE.test(x))) {
      blocks.push(cur);
      cur = [line];
      continue;
    }
    cur.push(line);
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

function parseBlock(block: string[]): EducationEntry {
  const entry: EducationEntry = {};
  for (const line of block) {
    if (!entry.degree && DEGREE_RE.test(line)) entry.degree = line.slice(0, 240);
    if (!entry.university && UNIVERSITY_RE.test(line)) entry.university = line.slice(0, 240);
    if (!entry.course && COURSE_RE.test(line)) entry.course = line.slice(0, 200);
    if (!entry.cgpa) {
      const m = line.match(CGPA_RE);
      if (m?.[1]) entry.cgpa = m[1].slice(0, 40);
    }
    if (!entry.startDate || !entry.endDate) {
      const d = parseDateRange(line);
      if (d.startDate && !entry.startDate) entry.startDate = d.startDate;
      if (d.endDate && !entry.endDate) entry.endDate = d.endDate;
    }
  }
  return entry;
}

export function extractEducation(
  sections: ResumeSections,
): { education: EducationEntry[]; confidence: Record<string, ConfidenceLevel> } {
  const confidence: Record<string, ConfidenceLevel> = {};
  const lines = clean(sections.education);
  if (lines.length === 0) return { education: [], confidence };

  const blocks = splitBlocks(lines);
  const entries = blocks
    .map(parseBlock)
    .filter((e) => Boolean(e.university || e.degree || e.course || e.cgpa || e.startDate || e.endDate))
    .slice(0, 8);

  if (entries.length > 0) {
    const strong = entries.some((e) => e.university && e.degree);
    confidence.education = strong ? "high" : "medium";
    if (entries.some((e) => e.cgpa)) confidence["education.cgpa"] = "high";
  }
  return { education: entries, confidence };
}
