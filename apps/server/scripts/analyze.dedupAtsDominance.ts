/**
 * Read-only: group canonical jobs by (companyId, normalized title, country, remote)
 * and classify pairwise primary fingerprint split (ats vs desc vs apply).
 * Run: npx tsx scripts/analyze.dedupAtsDominance.ts
 */
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import {
  extractCompanyDomain,
  normalizeApplyUrlForFingerprint,
  normalizeDescriptionForFingerprintV2,
  normalizeTitleForFingerprint,
} from "../src/utils/jobFingerprint.js";

loadRootEnv();
const prisma = new PrismaClient();

type Parts = {
  ats: string;
  descDigest: string;
  t: string;
  cc: string;
  remote: string;
  co: string;
  apply: string;
};

function partsForJob(row: {
  title: string;
  description: string | null;
  country: string;
  isRemote: boolean;
  atsJobId: string | null;
  applyUrl: string | null;
  companyId: string;
  careersUrl: string | null;
}): Parts {
  const companyDomain = extractCompanyDomain(row.careersUrl, row.companyId);
  const descNorm = normalizeDescriptionForFingerprintV2(row.description ?? undefined);
  const descDigest = descNorm
    ? createHash("sha256").update(descNorm, "utf8").digest("hex")
    : "";
  return {
    ats: row.atsJobId?.trim().toLowerCase() ?? "",
    descDigest,
    t: normalizeTitleForFingerprint(row.title),
    cc: (row.country || "UNKNOWN").trim().toUpperCase(),
    remote: row.isRemote ? "1" : "0",
    co: companyDomain.trim().toLowerCase(),
    apply: normalizeApplyUrlForFingerprint(row.applyUrl) || "",
  };
}

/** First differing segment in v2 payload order: ats → desc → apply (t/cc/remote/co fixed per bucket). */
function primarySplit(a: Parts, b: Parts): "ats" | "desc" | "apply" | "none" {
  if (a.ats !== b.ats) return "ats";
  if (a.descDigest !== b.descDigest) return "desc";
  if (a.apply !== b.apply) return "apply";
  return "none";
}

async function main(): Promise<void> {
  const rows = await prisma.job.findMany({
    where: { canonicalJobId: null },
    select: {
      id: true,
      title: true,
      description: true,
      country: true,
      isRemote: true,
      atsJobId: true,
      applyUrl: true,
      sourceUrl: true,
      companyId: true,
      fingerprint: true,
      company: { select: { careersUrl: true } },
    },
  });

  type Row = (typeof rows)[number];

  const byBucket = new Map<string, Row[]>();
  for (const r of rows) {
    const p = partsForJob({
      title: r.title,
      description: r.description,
      country: r.country,
      isRemote: r.isRemote,
      atsJobId: r.atsJobId,
      applyUrl: r.applyUrl,
      companyId: r.companyId,
      careersUrl: r.company.careersUrl,
    });
    const key = `${r.companyId}\t${p.t}\t${p.cc}\t${p.remote}`;
    const list = byBucket.get(key) ?? [];
    list.push(r);
    byBucket.set(key, list);
  }

  const fragmented = [...byBucket.entries()].filter(([, list]) => list.length >= 2);

  let pairTotal = 0;
  let primaryAts = 0;
  let primaryDesc = 0;
  let primaryApply = 0;
  let primaryNone = 0;

  const samples = {
    ats: [] as Array<{ title: string; companyId: string; a: string; b: string }>,
    desc: [] as Array<{ title: string; companyId: string; sourceUrlA: string; sourceUrlB: string }>,
    apply: [] as Array<{ title: string; companyId: string; applyA: string; applyB: string }>,
    none: [] as Array<{ title: string; companyId: string; ids: string[] }>,
  };

  for (const [, list] of fragmented) {
    const partsList = list.map((r) =>
      partsForJob({
        title: r.title,
        description: r.description,
        country: r.country,
        isRemote: r.isRemote,
        atsJobId: r.atsJobId,
        applyUrl: r.applyUrl,
        companyId: r.companyId,
        careersUrl: r.company.careersUrl,
      }),
    );

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const pr = primarySplit(partsList[i]!, partsList[j]!);
        pairTotal += 1;
        if (pr === "ats") {
          primaryAts += 1;
          if (samples.ats.length < 5) {
            samples.ats.push({
              title: list[i]!.title,
              companyId: list[i]!.companyId,
              a: partsList[i]!.ats || "(empty)",
              b: partsList[j]!.ats || "(empty)",
            });
          }
        } else if (pr === "desc") {
          primaryDesc += 1;
          if (samples.desc.length < 5) {
            samples.desc.push({
              title: list[i]!.title,
              companyId: list[i]!.companyId,
              sourceUrlA: list[i]!.sourceUrl,
              sourceUrlB: list[j]!.sourceUrl,
            });
          }
        } else if (pr === "apply") {
          primaryApply += 1;
          if (samples.apply.length < 5) {
            samples.apply.push({
              title: list[i]!.title,
              companyId: list[i]!.companyId,
              applyA: partsList[i]!.apply || "(empty)",
              applyB: partsList[j]!.apply || "(empty)",
            });
          }
        } else {
          primaryNone += 1;
          if (samples.none.length < 3) {
            samples.none.push({
              title: list[i]!.title,
              companyId: list[i]!.companyId,
              ids: [list[i]!.id, list[j]!.id],
            });
          }
        }
      }
    }
  }

  const pct = (n: number) => (pairTotal === 0 ? 0 : (100 * n) / pairTotal).toFixed(2);

  console.log(JSON.stringify({
    canonicalJobRows: rows.length,
    bucketsWith2PlusCanonicals: fragmented.length,
    pairwiseComparisonsInThoseBuckets: pairTotal,
    primarySplit_atsFirst: { count: primaryAts, pct: pct(primaryAts) },
    primarySplit_desc: { count: primaryDesc, pct: pct(primaryDesc) },
    primarySplit_apply: { count: primaryApply, pct: pct(primaryApply) },
    primarySplit_none: { count: primaryNone, pct: pct(primaryNone) },
    note:
      "Pairs share same companyId + normalizeTitleForFingerprint(title) + country + isRemote. Primary = first difference in v2 order: ats segment, then desc hash, then apply host+path.",
    samples,
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
