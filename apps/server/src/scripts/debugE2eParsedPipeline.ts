/**
 * Verify preprocess → AI parse → DB persist → API shape.
 *
 * Run (from apps/server, with DB + inference + optional API):
 *   npx tsx src/scripts/debugE2eParsedPipeline.ts
 *
 * Env: DATABASE_URL, AI_JOB_PARSER_URL (default http://localhost:8001), API_PORT for GET test.
 */
import { Prisma } from "@prisma/client";
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { createJobRepository } from "../modules/job/job.repository.js";
import { enrichCanonicalJobParsedDescription } from "../modules/ai/jobDescriptionEnrichment.js";
import {
  MAX_PREPROCESS_LINE_CHARS,
  preprocessDescription,
} from "../modules/ai/preprocessDescription.js";
import { parseJobDescriptionAI } from "../modules/ai/ai.service.js";
import { decodePersistedParsedLines } from "../modules/ai/jobParser.service.js";
import {
  emptyParsedJobDescription,
  type ParsedJobDescriptionAI,
} from "../modules/ai/ai.types.js";

function parsedHasBracketHints(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  const o = parsed as Record<string, unknown>;
  const keys = [
    "position",
    "responsibility",
    "requirement",
    "experience",
    "benefit",
    "contact",
    "other",
  ] as const;
  const re = /\[(?:OTHER|REQUIREMENTS)\]/i;
  for (const k of keys) {
    const v = o[k];
    if (!Array.isArray(v)) continue;
    for (const s of v) {
      if (typeof s === "string" && re.test(s)) return true;
    }
  }
  return false;
}

const ENTITY_LEAK_RE = /&(amp|nbsp|lt|gt|quot|#\d+);/i;

function assertNoEntityLeaks(label: string, parsed: ParsedJobDescriptionAI | null): boolean {
  if (!parsed) return true;
  let ok = true;
  for (const [bucket, lines] of Object.entries(parsed)) {
    if (!Array.isArray(lines)) continue;
    for (const line of lines) {
      if (typeof line !== "string") continue;
      if (ENTITY_LEAK_RE.test(line)) {
        console.error(`FAIL ${label}: ${bucket} line still has HTML entity:`, line.slice(0, 120));
        ok = false;
      }
    }
  }
  return ok;
}

const SAMPLE_DESC = `Senior Software Engineer
We are a fast-growing startup building the future of fintech.
Design and implement microservices using Go and Kubernetes
5+ years of experience in backend development
Health insurance and 401(k) matching
Email careers@company.com`;

function preprocessReport(raw: string): void {
  const rawLines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out = preprocessDescription(raw);
  const maxLen = out.length ? Math.max(...out.map((s) => s.length)) : 0;
  console.log(
    JSON.stringify(
      {
        rawNonEmptyLineCount: rawLines.length,
        afterPreprocessLineCount: out.length,
        maxLineChars: maxLen,
        maxAllowedChars: MAX_PREPROCESS_LINE_CHARS,
        exceedsCap: maxLen > MAX_PREPROCESS_LINE_CHARS,
      },
      null,
      2,
    ),
  );
  console.log("preprocessedLines:");
  out.forEach((line, i) => {
    console.log(`  ${String(i + 1).padStart(3, " ")}: ${line}`);
  });
}

async function main(): Promise<void> {
  loadRootEnv();

  console.log("--- decodePersistedParsedLines (entity smoke) ---");
  const decoded = decodePersistedParsedLines({
    ...emptyParsedJobDescription(),
    responsibility: ["Execute outbound sales &amp; marketing campaigns"],
    other: ["OS&nbsp; in the cloud", "Plain &lt;tag&gt; test"],
  });
  if (!assertNoEntityLeaks("decodePersistedParsedLines", decoded)) {
    process.exitCode = 1;
  } else {
    console.log("PASS: no &amp; / &nbsp; / common entities in decoded buckets");
    console.log("  sample:", decoded.responsibility[0], "|", decoded.other[0]);
  }

  console.log("\n--- COMPANY_BOILERPLATE preprocess (Canonical / Ubuntu) ---");
  const canonBlob = `Canonical is a global software company that publishes Ubuntu.

Ubuntu is the fastest growing Linux distribution in the world.

Acme ranks as the number one vendor in EMEA.`;
  const canonLines = preprocessDescription(canonBlob);
  const overviewPatterns = [
    /Canonical is a global/i,
    /Ubuntu is the fastest/i,
    /ranks as the number/i,
  ];
  let boilerplateOk = true;
  for (const line of canonLines) {
    const core = line.replace(/^\[OTHER\]\s*/i, "").trim();
    for (const re of overviewPatterns) {
      if (re.test(core) && !/^\[OTHER\]/i.test(line)) {
        console.error("FAIL: overview line missing [OTHER] prefix:", line.slice(0, 100));
        boilerplateOk = false;
      }
    }
  }
  if (boilerplateOk) {
    console.log("PASS: Canonical / Ubuntu / ranks lines carry [OTHER] in preprocess");
  } else {
    process.exitCode = 1;
  }
  canonLines.forEach((line, i) => {
    if (/\[OTHER\]/i.test(line)) console.log(`  ${i + 1}: ${line.slice(0, 100)}${line.length > 100 ? "…" : ""}`);
  });

  console.log("\n--- Preprocess sample (SAMPLE_DESC) ---");
  preprocessReport(SAMPLE_DESC);

  const jobRepository = createJobRepository(prisma);

  let row = await prisma.job.findFirst({
    where: {
      canonicalJobId: null,
      description: { not: null },
      OR: [
        { parsedDescription: { equals: Prisma.DbNull } },
        { parsedDescription: { equals: Prisma.JsonNull } },
      ],
    },
    select: { id: true, description: true, title: true },
    orderBy: { updatedAt: "desc" },
  });

  let rowSource = "canonical + null parsedDescription";
  if (!row?.description?.trim()) {
    row = await prisma.job.findFirst({
      where: { description: { not: null } },
      select: { id: true, description: true, title: true },
      orderBy: { updatedAt: "desc" },
    });
    rowSource = "fallback: any job with description";
  }

  if (!row?.description?.trim()) {
    console.error("No job with description in DB.");
    process.exitCode = 1;
    return;
  }

  console.log("\n(DB row source:", rowSource + ")");

  console.log("\n--- Preprocess first ~500 chars of DB job description ---");
  preprocessReport(row.description.slice(0, 2000));

  console.log("\n--- Model-only parse (no DB write) for DB job ---");
  const modelParsed = await parseJobDescriptionAI(row.description);
  console.log(
    "model buckets (counts):",
    modelParsed
      ? Object.fromEntries(
          Object.entries(modelParsed).map(([k, v]) => [k, (v as string[]).length]),
        )
      : null,
  );
  console.log(
    "model parsed lines contain [OTHER]/[REQUIREMENTS] prefix:",
    modelParsed ? parsedHasBracketHints(modelParsed) : "(n/a)",
  );
  if (modelParsed?.responsibility?.length) {
    console.log(
      "model responsibility sample (first 3):",
      modelParsed.responsibility.slice(0, 3),
    );
  }
  if (modelParsed && !assertNoEntityLeaks("model parse (post-persist decode)", modelParsed)) {
    process.exitCode = 1;
  }

  console.log("\n--- enrichCanonicalJobParsedDescription (inserted=true) ---");
  await enrichCanonicalJobParsedDescription(prisma, jobRepository, row.id, true);

  const after = await prisma.job.findUnique({
    where: { id: row.id },
    select: { parsedDescription: true, enriched: true },
  });

  console.log("\n--- DB after enrich ---");
  console.log(JSON.stringify(after, null, 2));
  console.log(
    "DB parsedDescription has [OTHER]/[REQUIREMENTS] prefix on any line:",
    parsedHasBracketHints(after?.parsedDescription),
  );
  const enr = after?.enriched as { salary?: string | null } | null;
  console.log("DB enriched.salary:", enr?.salary ?? null);
  const pdAfter = after?.parsedDescription as unknown as ParsedJobDescriptionAI | undefined;
  if (pdAfter && !assertNoEntityLeaks("DB parsedDescription", pdAfter)) {
    process.exitCode = 1;
  }

  if (pdAfter) {
    const badReq = pdAfter.requirement.filter(
      (l) =>
        /Canonical is a global software company/i.test(l) ||
        /Ubuntu is the fastest growing Linux/i.test(l) ||
        /Examples of customer success include/i.test(l),
    );
    if (badReq.length > 0) {
      console.error("FAIL: company overview lines still in requirement:", badReq);
      process.exitCode = 1;
    } else {
      console.log("PASS: Canonical / Ubuntu / customer-success overview lines not in requirement bucket");
    }
  }

  function bucketCounts(p: unknown): Record<string, number> {
    if (!p || typeof p !== "object") return {};
    const o = p as Record<string, unknown>;
    const keys = [
      "position",
      "responsibility",
      "requirement",
      "experience",
      "benefit",
      "contact",
      "other",
    ] as const;
    const out: Record<string, number> = {};
    for (const k of keys) {
      const v = o[k];
      out[k] = Array.isArray(v) ? v.length : 0;
    }
    return out;
  }

  if (modelParsed && after?.parsedDescription) {
    const m = bucketCounts(modelParsed);
    const d = bucketCounts(after.parsedDescription);
    const mismatches: string[] = [];
    for (const k of Object.keys(m)) {
      if ((m[k] ?? 0) > 0 && (d[k] ?? 0) === 0) {
        mismatches.push(`${k}: model had ${m[k]} persisted 0`);
      }
    }
    console.log("\n--- Model vs DB bucket mismatch (model non-empty -> DB empty) ---");
    console.log(mismatches.length ? mismatches.join("\n") : "(none)");
  }

  const apiPort = process.env.API_PORT ?? process.env.PORT;
  if (apiPort) {
    const base = `http://localhost:${apiPort}`;
    const url = `${base}/jobs/${row.id}`;
    console.log(`\n--- GET ${url} ---`);
    try {
      const res = await fetch(url);
      const body = (await res.json()) as { data?: Record<string, unknown> };
      const data = body.data;
      if (!data) {
        console.log("Unexpected response:", res.status, body);
      } else {
        const pd = data.parsedDescription;
        const en = data.enriched;
        console.log(
          JSON.stringify(
            {
              status: res.status,
              hasParsedDescription: pd != null && pd !== "",
              parsedBucketCounts: bucketCounts(pd),
              hasEnriched: en != null && en !== "",
              enrichedKeys: en && typeof en === "object" ? Object.keys(en as object) : [],
            },
            null,
            2,
          ),
        );
      }
    } catch (err) {
      const code = err && typeof err === "object" && "cause" in err ? (err as { cause?: { code?: string } }).cause?.code : "";
      console.log(
        `API request failed (${code || "network"}). Start the Fastify server on port ${apiPort} and re-run, or omit API_PORT/PORT to skip this step.`,
      );
      console.log("Job id for manual check:", row.id);
    }
  } else {
    console.log("\n(Set API_PORT or PORT to hit GET /jobs/:id for this job id:", row.id + ")");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
