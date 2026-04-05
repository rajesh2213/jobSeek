/**
 * Run live inference on several jobs and print bucket counts.
 * Usage: npx tsx src/scripts/debugJobParserBatch.ts [take]
 */
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { parseJobDescriptionAI } from "../modules/ai/ai.service.js";
import type { ParsedJobDescriptionAI } from "../modules/ai/ai.types.js";

function bucketCounts(p: ParsedJobDescriptionAI | null | undefined): Record<string, number> {
  if (!p || typeof p !== "object") return {};
  const out: Record<string, number> = {};
  for (const k of Object.keys(p) as (keyof ParsedJobDescriptionAI)[]) {
    const v = p[k];
    out[k] = Array.isArray(v) ? v.length : 0;
  }
  return out;
}

function nonEmptyBuckets(p: ParsedJobDescriptionAI): string[] {
  const keys: (keyof ParsedJobDescriptionAI)[] = [
    "position",
    "responsibility",
    "requirement",
    "experience",
    "benefit",
    "contact",
    "other",
  ];
  return keys.filter((k) => p[k].length > 0);
}

async function main(): Promise<void> {
  loadRootEnv();
  const take = Math.min(12, Math.max(3, parseInt(process.argv[2] ?? "6", 10) || 6));

  const rows = await prisma.job.findMany({
    where: { canonicalJobId: null, description: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, description: true, parsedDescription: true },
    take,
  });

  for (const row of rows) {
    const desc = row.description?.trim() ?? "";
    const inf = desc ? await parseJobDescriptionAI(desc, undefined, { jobTitle: row.title }) : null;
    const db = row.parsedDescription as unknown as ParsedJobDescriptionAI | undefined;

    const modelFilled =
      inf &&
      (inf.responsibility.length > 0 ||
        inf.requirement.length > 0 ||
        inf.experience.length > 0 ||
        inf.benefit.length > 0 ||
        inf.contact.length > 0);

    console.log("\n" + "=".repeat(72));
    console.log("id:", row.id);
    console.log("title:", row.title?.slice(0, 100) + (row.title && row.title.length > 100 ? "…" : ""));
    console.log("DB counts:", JSON.stringify(bucketCounts(db)));
    console.log("INFERENCE counts:", JSON.stringify(bucketCounts(inf ?? undefined)));
    console.log("INFERENCE non-empty buckets:", inf ? nonEmptyBuckets(inf).join(", ") : "(null)");
    console.log(
      "Model fills structured fields (resp/req/exp/benefit/contact)?",
      modelFilled ? "YES" : "NO",
    );
    const clip = (s: string) => (s.length > 120 ? `${s.slice(0, 120)}…` : s);
    if (inf && inf.responsibility.length)
      console.log("  sample responsibility[0]:", clip(inf.responsibility[0]!));
    if (inf && inf.requirement.length)
      console.log("  sample requirement[0]:", clip(inf.requirement[0]!));
    if (inf && inf.benefit.length)
      console.log("  sample benefit[0]:", clip(inf.benefit[0]!));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
