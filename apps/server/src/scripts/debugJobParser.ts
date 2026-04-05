/**
 * Compare raw description, DB parsedDescription, and live inference output.
 *
 * Run: npx tsx src/scripts/debugJobParser.ts <jobId>
 * Or:  npm run debug:job-parser -w @jobseek/server -- <jobId>
 */
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { parseJobDescriptionAI } from "../modules/ai/ai.service.js";

async function main(): Promise<void> {
  loadRootEnv();
  const jobId = process.argv[2]?.trim();
  if (!jobId) {
    console.error("Usage: npx tsx src/scripts/debugJobParser.ts <jobId>");
    process.exitCode = 1;
    return;
  }

  const row = await prisma.job.findUnique({
    where: { id: jobId },
    select: { title: true, description: true, parsedDescription: true },
  });

  if (!row) {
    console.error("Job not found:", jobId);
    process.exitCode = 1;
    return;
  }

  const inference =
    row.description?.trim().length ?
      await parseJobDescriptionAI(row.description, undefined, { jobTitle: row.title ?? null })
    : null;

  console.log("==== RAW ====\n");
  console.log(row.description ?? "(null)");
  console.log("\n==== DB PARSED ====\n");
  console.log(JSON.stringify(row.parsedDescription, null, 2));
  console.log("\n==== INFERENCE PARSED ====\n");
  console.log(JSON.stringify(inference, null, 2));
  console.log("\n==== TITLE (db) ====\n");
  console.log(row.title);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
