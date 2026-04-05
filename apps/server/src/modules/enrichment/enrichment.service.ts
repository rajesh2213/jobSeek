import type { ParsedJobDescriptionAI } from "../ai/ai.types.js";
import { emptyParsedJobDescription } from "../ai/ai.types.js";

export type JobEnrichmentRemoteType = "remote" | "hybrid" | "onsite";

export interface JobEnrichment {
  techStack: string[];
  salary: string | null;
  remote: boolean;
  remoteType: JobEnrichmentRemoteType | null;
}

/** Canonical keyword → display label (stable, deterministic). */
const TECH_KEYWORDS = [
  "react",
  "node",
  "typescript",
  "javascript",
  "python",
  "java",
  "c#",
  ".net",
  "aws",
  "docker",
  "kubernetes",
  "postgresql",
  "mysql",
  "mongodb",
  "redis",
  "graphql",
] as const;

const TECH_LABELS: Record<string, string> = {
  react: "React",
  node: "Node",
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  java: "Java",
  "c#": "C#",
  ".net": ".NET",
  aws: "AWS",
  docker: "Docker",
  kubernetes: "Kubernetes",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
  redis: "Redis",
  graphql: "GraphQL",
};

const BUCKETS: (keyof ParsedJobDescriptionAI)[] = [
  "position",
  "responsibility",
  "requirement",
  "experience",
  "benefit",
  "contact",
  "other",
];

function normalizeParsed(parsedDescription: unknown): ParsedJobDescriptionAI {
  if (!parsedDescription || typeof parsedDescription !== "object") {
    return emptyParsedJobDescription();
  }
  const o = parsedDescription as Record<string, unknown>;
  const out = emptyParsedJobDescription();
  for (const k of BUCKETS) {
    const v = o[k as string];
    if (!Array.isArray(v)) continue;
    out[k] = v
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return out;
}

function keywordMatches(text: string, kw: string): boolean {
  const lower = text.toLowerCase();
  const k = kw.toLowerCase();
  if (k === "c#") return lower.includes("c#");
  if (k === ".net") {
    return /(^|[^a-z0-9])\.net(?![a-z0-9])/i.test(text);
  }
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(text);
}

function extractTechStack(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const kw of TECH_KEYWORDS) {
    if (!keywordMatches(text, kw)) continue;
    const label = TECH_LABELS[kw.toLowerCase()] ?? kw;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/** 4–6 plain digits, or grouped like 120,000 (requires salary/currency context elsewhere). */
const MONEY_NUM = String.raw`(?:\d{4,6}|\d{1,3}(?:,\d{3})+)(?:\.\d{2})?`;

function extractSalary(text: string): string | null {
  const t = text.replace(/\s+/g, " ");

  const rangeK = t.match(/\$?\d{2,3}k\s*-\s*\$?\d{2,3}k\b/i);
  if (rangeK?.[0]) return rangeK[0].replace(/\s+/g, " ").trim();

  const singleK = t.match(/\$?\d{2,3}k\b/i);
  if (singleK?.[0]) return singleK[0].trim();

  const dollarRange = t.match(
    new RegExp(
      String.raw`\$\s*${MONEY_NUM}(?:\s*-\s*\$\s*${MONEY_NUM})?`,
      "i",
    ),
  );
  if (dollarRange?.[0]) return dollarRange[0].replace(/\s+/g, " ").trim();

  const codeAmount = t.match(
    new RegExp(
      String.raw`\b(?:USD|CAD)\s*\$?\s*${MONEY_NUM}(?:\s*-\s*(?:USD|CAD)?\s*\$?\s*${MONEY_NUM})?`,
      "i",
    ),
  );
  if (codeAmount?.[0]) return codeAmount[0].replace(/\s+/g, " ").trim();

  const gbpEur = t.match(
    new RegExp(String.raw`[£€]\s*${MONEY_NUM}(?:\s*-\s*[£€]?\s*${MONEY_NUM})?`, "i"),
  );
  if (gbpEur?.[0]) return gbpEur[0].replace(/\s+/g, " ").trim();

  const withTimeSuffix = t.match(
    new RegExp(
      String.raw`\b${MONEY_NUM}\s*(?:\/yr|\/year|\bper\s+year\b|\bannually\b)`,
      "i",
    ),
  );
  if (withTimeSuffix?.[0]) return withTimeSuffix[0].replace(/\s+/g, " ").trim();

  const withSalaryWord = t.match(
    new RegExp(
      String.raw`\b(?:salary|compensation|base\s+pay)\s*[:\s]+\$?\s*${MONEY_NUM}(?:\s*-\s*\$?\s*${MONEY_NUM})?(?:\s*k\b)?`,
      "i",
    ),
  );
  if (withSalaryWord?.[0]) return withSalaryWord[0].replace(/\s+/g, " ").trim();

  const payPhrase = t.match(
    new RegExp(
      String.raw`\bpay\s+range\s*[:\s]+\$?\s*${MONEY_NUM}(?:\s*-\s*\$?\s*${MONEY_NUM})?`,
      "i",
    ),
  );
  if (payPhrase?.[0]) return payPhrase[0].replace(/\s+/g, " ").trim();

  return null;
}

function extractRemoteSignals(text: string): Pick<JobEnrichment, "remote" | "remoteType"> {
  const hasRemoteWord = /\bremote\b/i.test(text) || /work\s+from\s+home/i.test(text);
  const hasHybrid = /\bhybrid\b/i.test(text);
  const hasOnsite = /\bonsite\b/i.test(text) || /\bon-site\b/i.test(text);

  const remote = hasRemoteWord || hasHybrid;

  let remoteType: JobEnrichmentRemoteType | null = null;
  if (hasHybrid) remoteType = "hybrid";
  else if (hasOnsite) remoteType = "onsite";
  else if (hasRemoteWord) remoteType = "remote";

  return { remote, remoteType };
}

/**
 * Deterministic, rule-based enrichment from structured parse buckets.
 * Scans requirement, responsibility, and other only (per product spec).
 */
export function enrichJob(parsedDescription: unknown): JobEnrichment {
  const p = normalizeParsed(parsedDescription);
  const lines = [...p.requirement, ...p.responsibility, ...p.other];
  const text = lines.join("\n");

  const techStack = extractTechStack(text);
  const salary = extractSalary(text);
  const { remote, remoteType } = extractRemoteSignals(text);

  return {
    techStack,
    salary,
    remote,
    remoteType,
  };
}
