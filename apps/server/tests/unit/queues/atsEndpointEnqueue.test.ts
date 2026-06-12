import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { Queue } from "bullmq";
import {
  atsEndpointJobId,
  enqueueAtsEndpointIngest,
} from "../../../src/queues/atsEndpointEnqueue.js";
import { INGEST_ATS_ENDPOINT_JOB } from "../../../src/queues/ats-endpoint.queue.js";

const ENDPOINT_ID = "ep-test-123";
const JOB_ID = atsEndpointJobId(ENDPOINT_ID);

type MockJob = {
  getState: ReturnType<typeof mock.fn>;
  remove: ReturnType<typeof mock.fn>;
};

function makeQueue(existing: MockJob | null, addImpl?: Queue["add"]) {
  const add = mock.fn(addImpl ?? (async () => undefined));
  const getJob = mock.fn(async () => existing);
  const queue = { add, getJob } as unknown as Queue;
  return { queue, add, getJob };
}

test("enqueueAtsEndpointIngest: enqueues new endpoint", async () => {
  const { queue, add, getJob } = makeQueue(null);

  const result = await enqueueAtsEndpointIngest(queue, ENDPOINT_ID);

  assert.equal(getJob.mock.calls.length, 1);
  assert.equal(getJob.mock.calls[0]?.arguments[0], JOB_ID);
  assert.equal(add.mock.calls.length, 1);
  assert.equal(add.mock.calls[0]?.arguments[0], INGEST_ATS_ENDPOINT_JOB);
  assert.deepEqual(add.mock.calls[0]?.arguments[1], { endpointId: ENDPOINT_ID });
  assert.deepEqual(add.mock.calls[0]?.arguments[2], { jobId: JOB_ID });
  assert.equal(result.action, "enqueued");
});

test("enqueueAtsEndpointIngest: skips waiting endpoint", async () => {
  const job: MockJob = {
    getState: mock.fn(async () => "waiting"),
    remove: mock.fn(async () => undefined),
  };
  const { queue, add } = makeQueue(job);

  const result = await enqueueAtsEndpointIngest(queue, ENDPOINT_ID);

  assert.equal(result.action, "skipped_duplicate");
  assert.equal(add.mock.calls.length, 0);
  assert.equal(job.remove.mock.calls.length, 0);
});

test("enqueueAtsEndpointIngest: skips active endpoint", async () => {
  const job: MockJob = {
    getState: mock.fn(async () => "active"),
    remove: mock.fn(async () => undefined),
  };
  const { queue, add } = makeQueue(job);

  const result = await enqueueAtsEndpointIngest(queue, ENDPOINT_ID);

  assert.equal(result.action, "skipped_duplicate");
  assert.equal(add.mock.calls.length, 0);
});

test("enqueueAtsEndpointIngest: skips delayed endpoint", async () => {
  const job: MockJob = {
    getState: mock.fn(async () => "delayed"),
    remove: mock.fn(async () => undefined),
  };
  const { queue, add } = makeQueue(job);

  const result = await enqueueAtsEndpointIngest(queue, ENDPOINT_ID);

  assert.equal(result.action, "skipped_duplicate");
  assert.equal(add.mock.calls.length, 0);
});

test("enqueueAtsEndpointIngest: reclaims failed endpoint", async () => {
  const job: MockJob = {
    getState: mock.fn(async () => "failed"),
    remove: mock.fn(async () => undefined),
  };
  const { queue, add } = makeQueue(job);

  const result = await enqueueAtsEndpointIngest(queue, ENDPOINT_ID);

  assert.equal(result.action, "reclaimed_failed");
  assert.equal(job.remove.mock.calls.length, 1);
  assert.equal(add.mock.calls.length, 1);
  assert.deepEqual(add.mock.calls[0]?.arguments[2], { jobId: JOB_ID });
});

test("enqueueAtsEndpointIngest: enqueues after completion", async () => {
  const job: MockJob = {
    getState: mock.fn(async () => "completed"),
    remove: mock.fn(async () => undefined),
  };
  const { queue, add } = makeQueue(job);

  const result = await enqueueAtsEndpointIngest(queue, ENDPOINT_ID);

  assert.equal(result.action, "enqueued");
  assert.equal(job.remove.mock.calls.length, 0);
  assert.equal(add.mock.calls.length, 1);
});
