/**
 * One-off backfill for jobs with incorrect work mode / location parsing.
 * Re-fetches Ashby/Lever public APIs where possible; Workday uses URL + title signals.
 *
 * Usage:
 *   npx tsx src/scripts/backfillAffectedWorkModeLocation.ts           # dry-run
 *   npx tsx src/scripts/backfillAffectedWorkModeLocation.ts --apply   # write DB
 */
import { loadRootEnv } from "../infrastructure/env/loadEnv.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { createJobRepository } from "../modules/job/job.repository.js";
import { parseAshbyJobs } from "../modules/ats/ashby/ashby.parser.js";
import type { AshbyJobBoardResponse } from "../modules/ats/ashby/ashby.types.js";
import { parseLeverJobs } from "../modules/ats/lever/lever.parser.js";
import type { LeverJob } from "../modules/ats/lever/lever.types.js";
import { fetchJsonWithTimeout, inferRemote } from "../modules/ats/ats.interface.js";
import type { DedupJobInput, NormalizedJob } from "../modules/crawler/crawler.types.js";
import {
  computeLocationPatchFromReingest,
  computeWorkModePatchFromReingest,
  recomputeCanonical,
} from "../services/jobCanonical.service.js";
import { enrichDedupInput } from "../utils/jobTaxonomyEnricher.js";
import { normalizeJobUrl } from "../utils/normalizeJobUrl.js";

type AffectedEntry = {
  sourceUrl: string;
  source: "workday" | "lever" | "ashby";
  /** Public board token for API re-fetch. */
  boardToken?: string;
};

const AFFECTED: AffectedEntry[] = [
  {
    sourceUrl:
      "https://evolent.wd1.myworkdayjobs.com/external/job/work-at-home/analyst--performance-suite-analytics_jr-915497-1",
    source: "workday",
  },
  {
    sourceUrl:
      "https://evolent.wd1.myworkdayjobs.com/external/job/work-at-home/family-medicine-physician-reviewer-field-medical-director--radiology--full-time-or-part-time-_jr-916323",
    source: "workday",
  },
  {
    sourceUrl:
      "https://evolent.wd1.myworkdayjobs.com/external/job/work-at-home/clinical-reviewer--nurse--radiology-_jr-916318",
    source: "workday",
  },
  {
    sourceUrl: "https://jobs.lever.co/octoenergy/751e86b3-657a-4ecb-910e-c3e3f8b9f174",
    source: "lever",
    boardToken: "octoenergy",
  },
  {
    sourceUrl: "https://jobs.ashbyhq.com/enode/e9000221-1375-4673-9a3a-fc5808cc4ee7",
    source: "ashby",
    boardToken: "enode",
  },
  {
    sourceUrl: "https://jobs.ashbyhq.com/enode/7268a541-3b62-4be5-beb5-5dfaab324a76",
    source: "ashby",
    boardToken: "enode",
  },
];

function parseArgs(argv: string[]): { apply: boolean } {
  return { apply: argv.includes("--apply") };
}

async function fetchAshbyJob(boardToken: string, sourceUrl: string): Promise<NormalizedJob | null> {
  const data = await fetchJsonWithTimeout<AshbyJobBoardResponse>(
    `https://api.ashbyhq.com/posting-api/job-board/${boardToken}`,
    10_000,
  );
  const jobs = data.jobs ?? [];
  const match = jobs.find((j) => {
    const u = (j.jobUrl ?? j.externalLink ?? "").trim();
    return u && normalizeJobUrl(u) === normalizeJobUrl(sourceUrl);
  });
  if (!match) return null;
  const parsed = parseAshbyJobs([match], "backfill");
  return parsed[0] ?? null;
}

async function fetchLeverJob(boardToken: string, sourceUrl: string): Promise<NormalizedJob | null> {
  const url = new URL(`https://api.lever.co/v0/postings/${boardToken}`);
  url.searchParams.set("mode", "json");
  const data = await fetchJsonWithTimeout<unknown>(url.toString(), 10_000);
  if (!Array.isArray(data)) return null;
  const jobs = data as LeverJob[];
  const match = jobs.find((j) => {
    const u = (j.hostedUrl ?? j.applyUrl ?? "").trim();
    return u && normalizeJobUrl(u) === normalizeJobUrl(sourceUrl);
  });
  if (!match) return null;
  const parsed = parseLeverJobs([match], "backfill");
  return parsed[0] ?? null;
}

function workdayNormalizedFromDb(
  row: { title: string; description: string | null; sourceUrl: string },
): NormalizedJob {
  const title = row.title.trim();
  const description = row.description ?? "";
  const isRemote =
    inferRemote(row.sourceUrl) || inferRemote(title) || inferRemote(description);
  return {
    title,
    description: description || undefined,
    isRemote,
    source: "workday",
    sourceUrl: row.sourceUrl,
    companyId: "backfill",
  };
}

async function buildIncoming(
  entry: AffectedEntry,
  row: { title: string; description: string | null; sourceUrl: string; company: { domain: string | null } },
): Promise<DedupJobInput | null> {
  let normalized: NormalizedJob | null = null;
  if (entry.source === "ashby" && entry.boardToken) {
    normalized = await fetchAshbyJob(entry.boardToken, entry.sourceUrl);
  } else if (entry.source === "lever" && entry.boardToken) {
    normalized = await fetchLeverJob(entry.boardToken, entry.sourceUrl);
  } else if (entry.source === "workday") {
    normalized = workdayNormalizedFromDb(row);
  }
  if (!normalized) return null;
  const domain = row.company.domain?.trim() || "unknown.local";
  return enrichDedupInput({ ...normalized, sourceUrl: row.sourceUrl, companyDomain: domain });
}

type RowSnapshot = {
  isRemote: boolean;
  workType: string;
  locationCountry: string;
  locationCity: string | null;
  locationRegion: string | null;
  country: string;
};

function snapshot(row: RowSnapshot) {
  return {
    isRemote: row.isRemote,
    workType: row.workType,
    locationCountry: row.locationCountry,
    locationCity: row.locationCity,
    locationRegion: row.locationRegion,
    country: row.country,
  };
}

async function main(): Promise<void> {
  loadRootEnv();
  const { apply } = parseArgs(process.argv.slice(2));
  const repo = createJobRepository(prisma);

  const results: Array<{
    sourceUrl: string;
    status: "ok" | "not_found" | "no_change" | "fetch_failed";
    before?: RowSnapshot;
    after?: RowSnapshot;
    patches?: string[];
  }> = [];

  for (const entry of AFFECTED) {
    const normalizedUrl = normalizeJobUrl(entry.sourceUrl);
    const row = await prisma.job.findFirst({
      where: { sourceUrl: normalizedUrl },
      include: { company: { select: { domain: true } } },
    });
    if (!row) {
      results.push({ sourceUrl: entry.sourceUrl, status: "not_found" });
      continue;
    }

    const incoming = await buildIncoming(entry, {
      title: row.title,
      description: row.description,
      sourceUrl: row.sourceUrl,
      company: row.company,
    });
    if (!incoming) {
      results.push({
        sourceUrl: entry.sourceUrl,
        status: "fetch_failed",
        before: snapshot(row),
      });
      continue;
    }

    const locPatch = computeLocationPatchFromReingest(row, incoming);
    const modePatch = computeWorkModePatchFromReingest(row, incoming);
    const patches: string[] = [];
    if (locPatch) patches.push("location");
    if (modePatch) patches.push("work_mode");

    const before = snapshot(row);
    let after = before;

    if (patches.length === 0) {
      results.push({ sourceUrl: entry.sourceUrl, status: "no_change", before });
      continue;
    }

    if (apply) {
      const data: Record<string, unknown> = {};
      if (locPatch) {
        Object.assign(data, locPatch);
      }
      if (modePatch) {
        Object.assign(data, modePatch);
      }
      await prisma.job.update({ where: { id: row.id }, data });
      const canonicalId = row.canonicalJobId ?? row.id;
      await recomputeCanonical(repo, canonicalId);
      const fresh = await prisma.job.findUnique({ where: { id: row.id } });
      if (fresh) after = snapshot(fresh);
    } else {
      after = {
        isRemote: modePatch?.isRemote ?? row.isRemote,
        workType: modePatch?.workType ?? row.workType,
        locationCountry: locPatch?.locationCountry ?? row.locationCountry,
        locationCity: locPatch?.locationCity ?? row.locationCity,
        locationRegion: locPatch?.locationRegion ?? row.locationRegion,
        country: locPatch?.country ?? row.country,
      };
    }

    results.push({
      sourceUrl: entry.sourceUrl,
      status: "ok",
      before,
      after,
      patches,
    });
  }

  console.log(JSON.stringify({ apply, results }, null, 2));

  const failed = results.filter((r) => r.status !== "ok" && r.status !== "no_change");
  if (failed.length > 0 && apply) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
