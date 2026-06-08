import type { JobItem } from "./api";
import {
  getCanonicalsFromTextLine,
  getCanonicalsFromRequirementLine,
} from "@jobseek/skill-constants";
import { MAX_RESUME_MATCH_KEYWORDS } from "./resumeKeywordFilter";

export type JobSkillSource =
  | "taxonomy"
  | "enriched"
  | "parsed_requirement"
  | "sparse_requirement"
  | "sparse_responsibility"
  | "role_hint"
  | "description_fallback"
  | "title_family";

export interface JobSkill {
  canonical: string;
  source: JobSkillSource;
  weight: number;
}

const W_TAX = 1.0;
const W_ENR = 0.9;
const W_REQ = 0.7;

function byWeightThenCanonical(a: JobSkill, b: JobSkill): number {
  if (b.weight !== a.weight) return b.weight - a.weight;
  return a.canonical.localeCompare(b.canonical);
}

/**
 * Map job data into a deduplicated, weighted list of dictionary-backed canonical skills
 * (taxonomy and enriched) plus `requirement` lines via phrase+token pass only.
 * No responsibility n-grams.
 */
export function extractJobSkills(job: JobItem): JobSkill[] {
  const byKey = new Map<string, JobSkill>();

  const put = (skill: JobSkill) => {
    const prev = byKey.get(skill.canonical);
    if (!prev || skill.weight > prev.weight) {
      byKey.set(skill.canonical, skill);
    }
  };

  for (const raw of job.skills ?? []) {
    for (const { canonical } of getCanonicalsFromTextLine(raw)) {
      put({ canonical, source: "taxonomy", weight: W_TAX });
    }
  }

  for (const raw of job.enriched?.techStack ?? []) {
    for (const { canonical } of getCanonicalsFromTextLine(String(raw))) {
      put({ canonical, source: "enriched", weight: W_ENR });
    }
  }

  for (const line of job.parsedDescription?.requirement ?? []) {
    for (const { canonical } of getCanonicalsFromRequirementLine(line)) {
      put({ canonical, source: "parsed_requirement", weight: W_REQ });
    }
  }

  const all = [...byKey.values()].sort(byWeightThenCanonical);
  return all.slice(0, MAX_RESUME_MATCH_KEYWORDS);
}

/**
 * Deduplicate canonicals for the semantic API (stable order: weight then name).
 */
export function jobSkillCanonicalsForSemantic(skills: JobSkill[]): string[] {
  const set = new Set<string>();
  const out: string[] = [];
  for (const s of [...skills].sort(byWeightThenCanonical)) {
    if (set.has(s.canonical)) continue;
    set.add(s.canonical);
    out.push(s.canonical);
  }
  return out;
}
