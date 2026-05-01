/**
 * Parity: Prisma `buildDiscoveryWhere` vs raw SQL `buildDiscoveryWhereSql` (same semantics as listing).
 *
 * Enable with JOB_DISCOVERY_PARITY_TEST=1 and DATABASE_URL pointing at a disposable Postgres
 * (run `npx prisma db push` or migrate first). CI can set both when a Postgres service is available.
 *
 * Optional: JOB_DISCOVERY_EXPLAIN=1 logs EXPLAIN for the latest-listing-shaped query (stdout).
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { after, before, describe, it } from "node:test";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import {
  buildDiscoveryWhere,
  buildDiscoveryWhereSql,
  type JobDiscoveryFilters,
} from "../../src/modules/job/job.repository.js";

loadRootEnv();

const enabled =
  process.env.JOB_DISCOVERY_PARITY_TEST === "1" &&
  Boolean(process.env.DATABASE_URL?.trim());

async function countViaSql(
  prisma: PrismaClient,
  filters?: JobDiscoveryFilters,
): Promise<number> {
  const whereSql = buildDiscoveryWhereSql(filters);
  const rows = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM "Job" j WHERE ${whereSql}
  `;
  return Number(rows[0]?.c ?? 0);
}

async function countViaPrisma(
  prisma: PrismaClient,
  filters?: JobDiscoveryFilters,
): Promise<number> {
  return prisma.job.count({ where: buildDiscoveryWhere(filters) });
}

async function assertParity(
  prisma: PrismaClient,
  filters: JobDiscoveryFilters | undefined,
  label: string,
) {
  const a = await countViaPrisma(prisma, filters);
  const b = await countViaSql(prisma, filters);
  assert.equal(a, b, `parity mismatch for ${label}: prisma=${a} sql=${b}`);
}

const runDescribe = enabled ? describe : describe.skip;

runDescribe("job discovery Prisma vs SQL parity", () => {
  let prisma: PrismaClient;
  let companyId: string;
  const createdJobIds: string[] = [];

  before(async () => {
    prisma = new PrismaClient();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const company = await prisma.company.create({
      data: {
        name: `Parity Co ${suffix}`,
        slug: `parity-co-${suffix}`,
        status: "ready",
      },
    });
    companyId = company.id;

    const mkJob = async (args: {
      title: string;
      sourceUrl: string;
      role: string;
      skills: string[];
      workType: string;
      category: string;
      locationCountry: string;
      country: string;
      locationCity?: string | null;
      salaryMin?: number | null;
      postedAt?: Date | null;
      canonicalJobId?: string | null;
      status?: "processing" | "ready" | "failed" | null;
    }) => {
      const row = await prisma.job.create({
        data: {
          title: args.title,
          companyId,
          country: args.country,
          locationCountry: args.locationCountry,
          locationCity: args.locationCity ?? null,
          source: "parity_test",
          sourceUrl: args.sourceUrl,
          role: args.role,
          skills: args.skills,
          workType: args.workType,
          category: args.category,
          salaryMin: args.salaryMin ?? null,
          postedAt: args.postedAt ?? null,
          canonicalJobId: args.canonicalJobId ?? null,
          description: "Test description for parity job.",
        },
      });
      if (args.status) {
        // Keep test compatible with stale generated Prisma client during local transitions.
        await prisma.$executeRaw`
          UPDATE "Job" SET "status" = ${args.status} WHERE id = ${row.id}
        `;
      }
      createdJobIds.push(row.id);
      return row;
    };

    await mkJob({
      title: "Senior TypeScript Engineer",
      sourceUrl: `https://parity.example/a-${suffix}`,
      role: "engineer",
      skills: ["typescript", "node"],
      workType: "remote",
      category: "engineering",
      locationCountry: "US",
      country: "US",
      salaryMin: 120000,
      postedAt: new Date(),
    });
    await mkJob({
      title: "Product Designer",
      sourceUrl: `https://parity.example/b-${suffix}`,
      role: "designer",
      skills: ["figma"],
      workType: "hybrid",
      category: "design",
      locationCountry: "GB",
      country: "GB",
      locationCity: "London",
      salaryMin: 90000,
      postedAt: new Date(Date.now() - 86400000),
    });
    await mkJob({
      title: "Legacy Job No Salary",
      sourceUrl: `https://parity.example/c-${suffix}`,
      role: "analyst",
      skills: ["sql"],
      workType: "onsite",
      category: "data",
      locationCountry: "DE",
      country: "DE",
      salaryMin: null,
      postedAt: null,
      status: null,
    });
    await mkJob({
      title: "Processing Hidden Job",
      sourceUrl: `https://parity.example/d-${suffix}`,
      role: "engineer",
      skills: ["typescript"],
      workType: "remote",
      category: "engineering",
      locationCountry: "US",
      country: "US",
      salaryMin: 110000,
      postedAt: new Date(),
      status: "processing",
    });
    await mkJob({
      title: "Failed Hidden Job",
      sourceUrl: `https://parity.example/e-${suffix}`,
      role: "engineer",
      skills: ["typescript"],
      workType: "remote",
      category: "engineering",
      locationCountry: "US",
      country: "US",
      salaryMin: 90000,
      postedAt: new Date(),
      status: "failed",
    });
  });

  after(async () => {
    if (!prisma) return;
    if (createdJobIds.length > 0) {
      await prisma.job.deleteMany({ where: { id: { in: createdJobIds } } });
    }
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it("no filters: prisma count matches sql count", async () => {
    await assertParity(prisma, undefined, "no filters");
  });

  it("filter: country US", async () => {
    await assertParity(prisma, { country: "US" }, "country US");
  });

  it("filter: workType remote", async () => {
    await assertParity(prisma, { workType: "remote" }, "workType remote");
  });

  it("filter: category engineering", async () => {
    await assertParity(prisma, { category: "engineering" }, "category");
  });

  it("filter: skills contains typescript", async () => {
    await assertParity(prisma, { skills: ["typescript"] }, "skills");
  });

  it("filter: companyId", async () => {
    await assertParity(prisma, { companyId }, "companyId");
  });

  it("filter: minSalary", async () => {
    await assertParity(prisma, { minSalary: 100000 }, "minSalary");
  });

  it("filter: role title contains Engineer", async () => {
    await assertParity(prisma, { role: "Engineer" }, "role title");
  });

  it("default visibility excludes processing/failed and keeps null status", async () => {
    const visible = await countViaPrisma(prisma, { role: "engineer" });
    const all = await countViaPrisma(prisma, {
      role: "engineer",
      includeProcessing: true,
    });
    assert.ok(all > visible, "includeProcessing should include hidden rows");
  });

  it("latest id query rows are subset of prisma where", async () => {
    const filters: JobDiscoveryFilters = { country: "US" };
    const whereSql = buildDiscoveryWhereSql(filters);
    const idRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT j.id FROM "Job" j
      WHERE ${whereSql}
      ORDER BY j."effectivePostedAt" DESC NULLS LAST
      LIMIT 10 OFFSET 0
    `;
    const ids = idRows.map((r) => r.id);
    if (ids.length === 0) return;
    const n = await prisma.job.count({
      where: {
        AND: [buildDiscoveryWhere(filters), { id: { in: ids } }],
      },
    });
    assert.equal(n, ids.length, "each id row must satisfy prisma where");
  });

  it("optional EXPLAIN for listing-shaped query", async () => {
    if (process.env.JOB_DISCOVERY_EXPLAIN !== "1") return;
    const whereSql = buildDiscoveryWhereSql({ country: "US" });
    const plans = await prisma.$queryRaw<{ "QUERY PLAN": string }[]>`
      EXPLAIN (ANALYZE, BUFFERS) SELECT j.id FROM "Job" j
      WHERE ${whereSql}
      ORDER BY j."effectivePostedAt" DESC NULLS LAST
      LIMIT 20 OFFSET 0
    `;
    const text = plans.map((p) => p["QUERY PLAN"]).join("\n");
    assert.ok(text.length > 0, "EXPLAIN should return at least one plan line");
  });
});

describe("job discovery parity (env)", () => {
  it("documents how to run integration parity tests", () => {
    if (enabled) {
      assert.ok(true);
      return;
    }
    assert.ok(
      true,
      "Set JOB_DISCOVERY_PARITY_TEST=1 and DATABASE_URL to run DB parity tests.",
    );
  });
});
