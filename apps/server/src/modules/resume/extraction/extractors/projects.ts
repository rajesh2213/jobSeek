import type { ConfidenceLevel, ProjectEntry, ResumeSections } from "../types.js";

const BULLET_RE = /^[•\-–—▪▸►✓✔*]\s*/;

function clean(lines: string[]): string[] {
  return lines.map((l) => l.trim()).filter(Boolean);
}

function looksProjectTitle(line: string): boolean {
  if (line.length < 3 || line.length > 140) return false;
  if (/^https?:\/\//i.test(line)) return false;
  if (/^[•\-–—▪▸►✓✔*]/.test(line)) return false;
  return /\b(project|app|system|platform|dashboard|tool|portal)\b/i.test(line) || /[:|-]/.test(line);
}

function splitBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if (cur.length === 0) {
      cur.push(line);
      continue;
    }
    if (looksProjectTitle(line) && cur.length >= 2) {
      blocks.push(cur);
      cur = [line];
      continue;
    }
    cur.push(line);
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

export function extractProjects(
  sections: ResumeSections,
): { projects: ProjectEntry[]; confidence: Record<string, ConfidenceLevel> } {
  const confidence: Record<string, ConfidenceLevel> = {};
  const lines = clean(sections.projects);
  if (!lines.length) return { projects: [], confidence };

  const projects = splitBlocks(lines)
    .map((block) => {
      const title = looksProjectTitle(block[0] ?? "") ? block[0] : undefined;
      const bullets = block
        .slice(title ? 1 : 0)
        .map((l) => l.replace(BULLET_RE, "").trim())
        .filter(Boolean)
        .slice(0, 20);
      return { title: title?.slice(0, 200), bullets };
    })
    .filter((p) => Boolean(p.title || p.bullets.length))
    .slice(0, 20);

  if (projects.length > 0) {
    confidence.projects = projects.some((p) => p.title && p.bullets.length > 0) ? "high" : "medium";
  }
  return { projects, confidence };
}
