/** Build dry-run conversion table for rollout report. */
import { writeFileSync } from "node:fs";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import { fetchCareersHtmlWithMeta } from "../../src/utils/fetchCareersHtml.js";
import { extractAshbyToken } from "../../src/modules/discovery/extractors/ashby.extractor.js";
import { extractGreenhouseToken } from "../../src/modules/discovery/extractors/greenhouse.extractor.js";
import {
  INVALID_ATS_BOARD_TOKENS,
  isInvalidAtsBoardToken,
} from "../../src/modules/discovery/extractors/atsTokenValidation.js";

loadRootEnv();

async function main(): Promise<void> {
  const companies = await prisma.company.findMany({
    where: { atsBoardToken: { in: [...INVALID_ATS_BOARD_TOKENS] } },
    select: { name: true, atsType: true, atsBoardToken: true, careersUrl: true },
  });

  const rows: Array<{ company: string; ats: string; old: string; new: string | null; action: string }> = [];

  for (const c of companies) {
    const old = c.atsBoardToken ?? "";
    let newTok: string | null = null;
    const url = c.careersUrl?.trim();
    if (url && c.atsType) {
      const meta = await fetchCareersHtmlWithMeta(url, 12_000);
      const html = meta.html ?? "";
      if (meta.fetched && html.length > 500) {
        if (c.atsType === "ashby") newTok = extractAshbyToken(html, url);
        if (c.atsType === "greenhouse") newTok = extractGreenhouseToken(html, url);
      }
    }
    const action =
      newTok && !isInvalidAtsBoardToken(newTok)
        ? "recover"
        : newTok && isInvalidAtsBoardToken(newTok)
          ? "REJECT_SUSPICIOUS"
          : "clear";
    rows.push({
      company: c.name,
      ats: c.atsType ?? "",
      old,
      new: newTok,
      action,
    });
  }

  const suspicious = rows.filter(
    (r) =>
      r.action === "REJECT_SUSPICIOUS" ||
      (r.new && ["posting-api", "embed", "login", "signin", "api"].includes(r.new)),
  );

  const md = [
    "# Slug Fix Migration Dry Run",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Companies affected: **${rows.length}**`,
    `- Recover: **${rows.filter((r) => r.action === "recover").length}**`,
    `- Clear: **${rows.filter((r) => r.action === "clear").length}**`,
    `- Suspicious (would block rollout): **${suspicious.length}**`,
    "",
    "## Conversion table",
    "",
    "| Company | ATS | Old | New | Action |",
    "|---------|-----|-----|-----|--------|",
    ...rows.map(
      (r) =>
        `| ${r.company} | ${r.ats} | ${r.old} | ${r.new ?? "(null)"} | ${r.action} |`,
    ),
    "",
    "## Validation",
    "",
    suspicious.length === 0
      ? "**PASS** — No conversion preserves posting-api, embed, login, signin, or api."
      : `**FAIL** — Review suspicious rows:\n${suspicious.map((r) => `- ${r.company}: ${r.old} → ${r.new}`).join("\n")}`,
  ].join("\n");

  writeFileSync("/home/ubuntu/jobSeek/docs/rollout/slug-fix-dry-run.md", md);
  writeFileSync(
    "/home/ubuntu/jobSeek/docs/rollout/slug-fix-dry-run.json",
    JSON.stringify({ rows, suspicious }, null, 2),
  );
  console.log(md);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
