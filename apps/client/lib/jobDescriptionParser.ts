export interface ParsedJobDescription {
  intro: string;
  responsibilities: string[];
  requirements: string[];
  benefits: string[];
  others: string[];
}

type SectionKey = keyof Omit<ParsedJobDescription, "intro">;

function normalizeLine(line: string): string {
  return line
    .replace(/^[\s>*-]+/, "")
    .replace(/^•\s*/, "")
    .trim();
}

function detectSection(line: string): SectionKey | null {
  if (/responsib/i.test(line)) return "responsibilities";
  if (/requirement|qualification|experience/i.test(line)) return "requirements";
  if (/benefit|perk|offer/i.test(line)) return "benefits";
  const low = line.toLowerCase();
  if (/^[a-z\s]+:$/.test(low)) return "others";
  return null;
}

function splitIntoLines(raw: string): string[] {
  return raw
    .split(/\n|•|\u2022|-|\*/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 20);
}

export function parseJobDescription(raw: string | null | undefined): ParsedJobDescription {
  const parsed: ParsedJobDescription = {
    intro: "",
    responsibilities: [],
    requirements: [],
    benefits: [],
    others: [],
  };
  if (!raw?.trim()) return parsed;

  const lines = splitIntoLines(raw);
  let currentSection: SectionKey | null = null;
  const introLines: string[] = [];

  for (const line of lines) {
    const normalized = normalizeLine(line);
    if (!normalized) continue;

    const section = detectSection(normalized);
    if (section) {
      currentSection = section;
      continue;
    }

    if (currentSection) {
      parsed[currentSection].push(normalized);
    } else {
      introLines.push(normalized);
    }
  }

  parsed.intro = introLines.join(" ");
  if (
    !parsed.responsibilities.length &&
    !parsed.requirements.length &&
    !parsed.benefits.length
  ) {
    return {
      intro: raw.trim(),
      responsibilities: [],
      requirements: [],
      benefits: [],
      others: [],
    };
  }
  if (!parsed.intro) {
    parsed.intro = raw.trim();
  }
  return parsed;
}
