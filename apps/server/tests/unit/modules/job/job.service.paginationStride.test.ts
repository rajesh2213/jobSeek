import assert from "node:assert/strict";
import test from "node:test";
import type { JobWithCompany } from "../../../../src/modules/job/job.repository.js";
import { JobService } from "../../../../src/modules/job/job.service.js";

test("list uses paginationStride for offset when limit is clamped below stride", async () => {
  let captured: { limit: number; offset: number } | null = null;
  const repo = {
    async findManyCanonicalFiltered(opts: {
      filters?: unknown;
      limit: number;
      offset: number;
      sort?: string;
      includeProcessing?: boolean;
    }): Promise<JobWithCompany[]> {
      captured = { limit: opts.limit, offset: opts.offset };
      return [];
    },
  };
  const svc = new JobService(repo as never);
  await svc.list({ page: 4, limit: 15, paginationStride: 20 });
  assert.equal(captured?.offset, 60);
  assert.equal(captured?.limit, 15);
});

test("list defaults stride to limit when paginationStride omitted", async () => {
  let captured: { limit: number; offset: number } | null = null;
  const repo = {
    async findManyCanonicalFiltered(opts: {
      limit: number;
      offset: number;
    }): Promise<JobWithCompany[]> {
      captured = { limit: opts.limit, offset: opts.offset };
      return [];
    },
  };
  const svc = new JobService(repo as never);
  await svc.list({ page: 4, limit: 15 });
  assert.equal(captured?.offset, 45);
  assert.equal(captured?.limit, 15);
});
