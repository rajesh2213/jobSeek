/**
 * Transforms structured job_dataset.json into line-level labeled training samples.
 * Text must not leak label hints (no "Responsibility:", "Skill required:", etc.).
 *
 * Run (full regen from job_dataset.json):
 *   npx tsx src/scripts/generateTrainingData.ts
 *
 * Run (strip prefixes from existing training-data.json only):
 *   npx tsx src/scripts/generateTrainingData.ts --clean-output
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIN_TEXT_LEN = 3;

export interface TrainingSample {
  text: string;
  label: string;
}

interface RawJob {
  JobID?: string;
  Title?: string;
  ExperienceLevel?: string;
  YearsOfExperience?: string;
  Skills?: string[];
  Responsibilities?: string[];
  Keywords?: string[];
}

function resolvePaths(): { inputPath: string; outputPath: string } {
  return {
    inputPath: path.join(__dirname, "job_dataset.json"),
    outputPath: path.join(__dirname, "training-data.json"),
  };
}

function trimSafe(s: unknown): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  return t.length ? t : null;
}

/**
 * Remove legacy prefixed training lines (from older generator runs).
 */
function stripLegacyPrefixes(input: string): string {
  let text = input.trim();
  for (let pass = 0; pass < 12; pass++) {
    const before = text;

    const contactMd = text.match(/^Contact:\s*\[([^\]]+)\]\(mailto:[^)]+\)\s*/i);
    if (contactMd) {
      text = contactMd[1].trim();
      continue;
    }

    text = text
      .replace(
        /^(Responsibility:|Skill required:|Required keyword:|Position:|Experience required:|Level:|Benefit:|Contact:)\s*/i,
        "",
      )
      .replace(/^Skill required for .+? position:\s*/i, "")
      .replace(/^Required keyword for .+? role:\s*/i, "")
      .replace(/^Level for .+? opening:\s*/i, "")
      .replace(/^Responsibility as .+?:\s*/i, "")
      .replace(/^Experience required:\s*/i, "")
      .trim();

    if (text === before) break;
  }

  text = text.replace(/\s*\(for [^)]+\)\s*$/i, "").trim();
  return text;
}

/** Natural phrasing for years / range (no "experience required" wording). */
function formatYearsExperiencePhrase(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  if (/^\d+\+$/i.test(v)) {
    const n = v.replace(/\+/i, "");
    return `${n}+ years experience`;
  }
  if (/^\d+\s*-\s*\d+$/i.test(v)) {
    const parts = v.split(/\s*-\s*/);
    if (parts.length === 2) {
      return `${parts[0]} to ${parts[1]} years experience`;
    }
  }
  if (/^\d+$/i.test(v)) {
    return `${v} years experience`;
  }
  return `${v} years experience`;
}

function normalizeSample(sample: TrainingSample): TrainingSample | null {
  const text = stripLegacyPrefixes(sample.text).trim();
  if (text.length < MIN_TEXT_LEN) return null;
  return { text, label: sample.label };
}

function samplesFromJob(job: RawJob): TrainingSample[] {
  const out: TrainingSample[] = [];

  const title = trimSafe(job.Title);
  if (title) out.push({ text: title, label: "position" });

  const level = trimSafe(job.ExperienceLevel);
  if (level) out.push({ text: level, label: "experience" });

  const years = trimSafe(job.YearsOfExperience);
  if (years) {
    out.push({ text: formatYearsExperiencePhrase(years), label: "experience" });
  }

  for (const s of job.Skills ?? []) {
    const skill = trimSafe(s);
    if (skill) out.push({ text: skill, label: "requirement" });
  }

  for (const k of job.Keywords ?? []) {
    const kw = trimSafe(k);
    if (kw) out.push({ text: kw, label: "requirement" });
  }

  for (const r of job.Responsibilities ?? []) {
    const resp = trimSafe(r);
    if (resp) out.push({ text: resp, label: "responsibility" });
  }

  return out;
}

function dedupeKey(s: TrainingSample): string {
  return `${s.label}\t${s.text}`;
}

function dedupe(samples: TrainingSample[]): TrainingSample[] {
  const seen = new Set<string>();
  const result: TrainingSample[] = [];
  for (const s of samples) {
    const k = dedupeKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    result.push(s);
  }
  return result;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  shuffleInPlace(copy);
  return copy.slice(0, Math.min(n, copy.length));
}

function buildSyntheticBenefitSamples(target = 100): TrainingSample[] {
  const bases = [
    "Health insurance provided",
    "Dental and vision coverage",
    "Paid time off",
    "Unlimited PTO",
    "Flexible working hours",
    "Remote work options",
    "401k matching",
    "Employee stock purchase plan",
    "Annual bonus program",
    "Learning and development budget",
    "Gym membership reimbursement",
    "Parental leave",
    "Commuter benefits",
    "Home office stipend",
    "Team retreats",
    "Life insurance",
    "Short-term disability coverage",
    "Employee assistance program",
    "Flexible spending account",
    "Professional conference attendance",
    "Mentorship program",
  ];
  const out: TrainingSample[] = [];
  for (let i = 0; i < target; i++) {
    const b = bases[i % bases.length];
    const cycle = Math.floor(i / bases.length);
    const suffix = cycle > 0 ? ` — package tier ${cycle + 1}` : "";
    out.push({ text: `${b}${suffix}`, label: "benefit" });
  }
  return out;
}

function buildSyntheticContactSamples(target = 100): TrainingSample[] {
  const localParts = [
    "hr",
    "careers",
    "talent",
    "recruiting",
    "jobs",
    "people",
    "hiring",
    "apply",
    "work",
    "hello",
  ];
  const domains = [
    "company.com",
    "startup.io",
    "corp.net",
    "tech.co",
    "labs.dev",
    "group.org",
    "hq.email",
    "team.net",
    "hire.us",
    "work.place",
  ];
  const out: TrainingSample[] = [];
  for (let i = 0; i < target; i++) {
    const lp = localParts[i % localParts.length];
    const d = domains[Math.floor(i / localParts.length) % domains.length];
    const batch = Math.floor(i / (localParts.length * domains.length));
    const addr = batch > 0 ? `${lp}.team${batch}@${d}` : `${lp}@${d}`;
    out.push({ text: addr, label: "contact" });
  }
  return out;
}

function buildSyntheticOtherSamples(target = 100): TrainingSample[] {
  const lines = [
    "We are an equal opportunity employer",
    "All qualified applicants will be considered without regard to race or gender",
    "Accommodations are available upon request",
    "This role may require a background check",
    "Authorization to work in the listed country is required",
    "We value diversity and inclusion",
    "No agencies please",
    "Direct applicants only",
    "This posting will remain open until filled",
    "Salary commensurate with experience",
  ];
  const out: TrainingSample[] = [];
  for (let i = 0; i < target; i++) {
    const base = lines[i % lines.length];
    const tag = i >= lines.length ? ` (variant ${Math.floor(i / lines.length)})` : "";
    out.push({ text: `${base}${tag}`, label: "other" });
  }
  return out;
}

function countByLabel(samples: TrainingSample[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of samples) {
    counts[s.label] = (counts[s.label] ?? 0) + 1;
  }
  return counts;
}

/** Re-read training-data.json, strip legacy prefixes, validate, dedupe, rewrite. */
async function cleanExistingOutputFile(outputPath: string): Promise<TrainingSample[]> {
  const raw = await readFile(outputPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("training-data.json must be a JSON array");
  }
  const out: TrainingSample[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text : "";
    const label = typeof r.label === "string" ? r.label : "";
    const normalized = normalizeSample({ text, label });
    if (normalized) out.push(normalized);
  }
  return dedupe(out);
}

async function main(): Promise<void> {
  const { inputPath, outputPath } = resolvePaths();
  const cleanOutputOnly = process.argv.includes("--clean-output");

  let combined: TrainingSample[];

  if (cleanOutputOnly) {
    combined = await cleanExistingOutputFile(outputPath);
    shuffleInPlace(combined);
  } else {
    const raw = await readFile(inputPath, "utf8");
    const jobs = JSON.parse(raw) as RawJob[];
    if (!Array.isArray(jobs)) {
      throw new Error("job_dataset.json must be a JSON array");
    }

    const fromJobs: TrainingSample[] = [];
    for (const job of jobs) {
      fromJobs.push(...samplesFromJob(job));
    }

    const synthetic: TrainingSample[] = [
      ...buildSyntheticBenefitSamples(100),
      ...buildSyntheticContactSamples(100),
      ...buildSyntheticOtherSamples(100),
    ];

    const normalized = [...fromJobs, ...synthetic]
      .map((s) => normalizeSample(s))
      .filter((s): s is TrainingSample => s != null);

    combined = dedupe(normalized);
    shuffleInPlace(combined);
  }

  await writeFile(outputPath, JSON.stringify(combined, null, 2), "utf8");

  const counts = countByLabel(combined);
  const total = combined.length;

  console.log(JSON.stringify({ totalSamples: total, perLabel: counts }, null, 2));

  const preview = pickRandom(combined, 10);
  console.log("Sample preview (10 random):");
  console.log(JSON.stringify(preview, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
