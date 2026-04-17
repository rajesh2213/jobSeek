import type { ResumeSections } from "./types.js";

const HEADING_MAP: Array<{ key: keyof ResumeSections; words: string[] }> = [
  { key: "summary", words: ["summary", "profile", "professional summary", "about me"] },
  { key: "experience", words: ["experience", "work experience", "employment", "professional experience"] },
  { key: "education", words: ["education", "academic", "academics"] },
  { key: "skills", words: ["skills", "technical skills", "core skills", "competencies"] },
  { key: "projects", words: ["projects", "project experience"] },
  { key: "certifications", words: ["certifications", "certificates", "licenses"] },
  { key: "languages", words: ["languages", "spoken languages"] },
];

function normalizeLine(raw: string): string {
  return raw
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function headingKey(line: string): keyof ResumeSections | null {
  const lower = line
    .toLowerCase()
    .replace(/[:\-–—|]+$/g, "")
    .trim();
  if (!lower) return null;
  if (lower.length > 48) return null;
  for (const item of HEADING_MAP) {
    if (item.words.some((w) => lower === w || lower.includes(w))) {
      return item.key;
    }
  }
  return null;
}

export function detectSections(text: string): ResumeSections {
  const out: ResumeSections = {
    summary: [],
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
    languages: [],
    other: [],
  };

  let current: keyof ResumeSections = "other";
  const lines = text.split("\n").map(normalizeLine).filter(Boolean);

  for (const line of lines) {
    // Heading-based routing keeps parsing deterministic and debuggable.
    const hk = headingKey(line);
    if (hk) {
      current = hk;
      continue;
    }
    out[current].push(line);
  }
  return out;
}
