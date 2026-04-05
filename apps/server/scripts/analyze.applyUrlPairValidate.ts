/**
 * Sample random pairs: same company + norm title + country + remote, different applyUrl.
 * Classify A/B using description token Jaccard only (see thresholds in output).
 * Run: npx tsx scripts/analyze.applyUrlPairValidate.ts
 */
import { PrismaClient } from "@prisma/client";
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import {
  normalizeApplyUrlForFingerprint,
  normalizeTitleForFingerprint,
} from "../src/utils/jobFingerprint.js";
import { stringSimilarity } from "../src/utils/jobSimilarity.js";

loadRootEnv();
const prisma = new PrismaClient();

const SAMPLE_SIZE = 20;

function skillsJaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

type Row = {
  id: string;
  title: string;
  description: string | null;
  country: string;
  isRemote: boolean;
  applyUrl: string | null;
  sourceUrl: string;
  companyId: string;
  category: string;
  role: string;
  skills: string[];
  company: { careersUrl: string | null };
};

function applyKey(url: string | null): string {
  return normalizeApplyUrlForFingerprint(url) || "";
}

async function main(): Promise<void> {
  const rows = (await prisma.job.findMany({
    where: { canonicalJobId: null },
    select: {
      id: true,
      title: true,
      description: true,
      country: true,
      isRemote: true,
      applyUrl: true,
      sourceUrl: true,
      companyId: true,
      category: true,
      role: true,
      skills: true,
      company: { select: { careersUrl: true } },
    },
  })) as Row[];

  const byBucket = new Map<string, Row[]>();
  for (const r of rows) {
    const t = normalizeTitleForFingerprint(r.title);
    const cc = (r.country || "UNKNOWN").trim().toUpperCase();
    const rem = r.isRemote ? "1" : "0";
    const key = `${r.companyId}\t${t}\t${cc}\t${rem}`;
    const list = byBucket.get(key) ?? [];
    list.push(r);
    byBucket.set(key, list);
  }

  type Pair = { a: Row; b: Row; applyA: string; applyB: string };
  const pairs: Pair[] = [];
  for (const [, list] of byBucket) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const ai = applyKey(list[i]!.applyUrl);
        const aj = applyKey(list[j]!.applyUrl);
        if (!ai || !aj || ai === aj) continue;
        pairs.push({ a: list[i]!, b: list[j]!, applyA: ai, applyB: aj });
      }
    }
  }

  const MIN_DESC = 120;
  const pairsWithDesc = pairs.filter(
    (p) =>
      (p.a.description?.trim().length ?? 0) >= MIN_DESC &&
      (p.b.description?.trim().length ?? 0) >= MIN_DESC,
  );
  const pool = pairsWithDesc.length >= SAMPLE_SIZE ? pairsWithDesc : pairs;
  shuffleInPlace(pool);
  const sample = pool.slice(0, SAMPLE_SIZE);

  /** Heuristic only — documented thresholds, not product truth. */
  const THRESH_A = 0.78;
  const THRESH_B = 0.42;

  let countA = 0;
  let countB = 0;
  let countU = 0;

  const details: Array<{
    titleRawA: string;
    titleRawB: string;
    titleIdentical: boolean;
    descSim: number | null;
    categoryMatch: boolean;
    roleMatch: boolean;
    skillsJaccard: number;
    classification: "A" | "B" | "U";
    applyA: string;
    applyB: string;
    sourceUrlA: string;
    sourceUrlB: string;
  }> = [];

  for (const { a, b, applyA, applyB } of sample) {
    const da = a.description?.trim() ?? "";
    const db = b.description?.trim() ?? "";
    let descSim: number | null;
    if (!da && !db) descSim = null;
    else descSim = stringSimilarity(da, db);

    const titleIdentical = a.title.trim() === b.title.trim();
    const categoryMatch = a.category === b.category;
    const roleMatch = a.role === b.role;
    const sj = skillsJaccard(a.skills ?? [], b.skills ?? []);

    let classification: "A" | "B" | "U";
    if (descSim === null) {
      classification = "U";
    } else if (descSim >= THRESH_A) {
      classification = "A";
    } else if (descSim <= THRESH_B) {
      classification = "B";
    } else {
      classification = "U";
    }

    if (classification === "A") countA++;
    else if (classification === "B") countB++;
    else countU++;

    details.push({
      titleRawA: a.title,
      titleRawB: b.title,
      titleIdentical,
      descSim,
      categoryMatch,
      roleMatch,
      skillsJaccard: sj,
      classification,
      applyA,
      applyB,
      sourceUrlA: a.sourceUrl,
      sourceUrlB: b.sourceUrl,
    });
  }

  const n = sample.length;
  const pct = (c: number) => (n === 0 ? "0" : ((100 * c) / n).toFixed(1));

  console.log(
    JSON.stringify(
      {
        methodology: {
          pairCriteria:
            "canonicalJobId null; same companyId + normalizeTitleForFingerprint(title) + country + isRemote; different normalizeApplyUrlForFingerprint(applyUrl). Prefer random sample from pairs where both descriptions >= minDescChars when enough exist.",
          classificationHeuristic: {
            A_same_job_reposted: `description stringSimilarity (token Jaccard) >= ${THRESH_A}`,
            B_different_jobs: `description similarity <= ${THRESH_B} (when both have text; see null case)`,
            U_uncertain: "between thresholds, or both descriptions empty",
            note: "Structured fields (category, role, skills) are reported but not used to force A/B except in narrative.",
          },
        },
        poolPairsDifferentApply: pairs.length,
        poolPairsBothDescMinChars: pairsWithDesc.length,
        minDescCharsForRichSample: MIN_DESC,
        usedRichDescPool: pairsWithDesc.length >= SAMPLE_SIZE,
        sampleSize: n,
        counts: { A: countA, B: countB, U: countU },
        pct_of_sample: { A: pct(countA), B: pct(countB), U: pct(countU) },
        pct_A_vs_B_among_resolved: {
          denominator: countA + countB,
          pctA: countA + countB === 0 ? "0" : ((100 * countA) / (countA + countB)).toFixed(1),
          pctB: countA + countB === 0 ? "0" : ((100 * countB) / (countA + countB)).toFixed(1),
        },
        five_examples: details.slice(0, 5),
        all_twenty: details,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
