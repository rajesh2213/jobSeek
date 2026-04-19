import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import {
  cosineSimilarity,
  embedSentences,
  getInferenceHttpTimeoutMs,
  matchEmbeddingsToBullets,
} from "../../../src/utils/resumeEmbedder.js";

/** Reference implementation: nested loops + cosineSimilarity (pre-optimization behavior). */
function matchEmbeddingsToBulletsNaive(
  keywords: string[],
  keywordEmbeddings: number[][],
  bullets: string[],
  bulletEmbeddings: number[][],
): Record<string, { bullet: string; similarity: number }> {
  const out: Record<string, { bullet: string; similarity: number }> = {};
  if (!keywords.length || !bullets.length || !bulletEmbeddings.length) return out;
  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i] ?? "";
    const kvec = keywordEmbeddings[i];
    if (!kw || !Array.isArray(kvec) || kvec.length === 0) continue;
    let bestIdx = -1;
    let best = -1;
    for (let j = 0; j < bulletEmbeddings.length; j++) {
      const bvec = bulletEmbeddings[j];
      if (!Array.isArray(bvec) || bvec.length === 0) continue;
      const sim = cosineSimilarity(kvec, bvec);
      if (sim > best) {
        best = sim;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0 && bullets[bestIdx]) {
      out[kw] = { bullet: bullets[bestIdx], similarity: best };
    }
  }
  return out;
}

function assertDeepEqualMatches(
  a: Record<string, { bullet: string; similarity: number }>,
  b: Record<string, { bullet: string; similarity: number }>,
) {
  assert.equal(Object.keys(a).sort().join(","), Object.keys(b).sort().join(","));
  for (const k of Object.keys(a)) {
    assert.equal(a[k]?.bullet, b[k]?.bullet);
    assert.equal(a[k]?.similarity, b[k]?.similarity);
  }
}

describe("matchEmbeddingsToBullets parity vs naive", () => {
  it("matches naive implementation for uniform embedding dimension (fast path)", () => {
    const keywords = ["a", "b"];
    const bullets = ["x", "y", "z"];
    const keywordEmbeddings = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ];
    const bulletEmbeddings = [
      [0.9, 0.1, 0, 0],
      [0, 0.8, 0.2, 0],
      [0, 0, 0, 1],
    ];
    const opt = matchEmbeddingsToBullets(keywords, keywordEmbeddings, bullets, bulletEmbeddings);
    const naive = matchEmbeddingsToBulletsNaive(keywords, keywordEmbeddings, bullets, bulletEmbeddings);
    assertDeepEqualMatches(opt, naive);
  });

  it("matches naive when keyword/bullet rows have differing lengths (slow path)", () => {
    const keywords = ["k1", "k2"];
    const bullets = ["b1", "b2"];
    const keywordEmbeddings = [[1, 2], [3, 4, 5]];
    const bulletEmbeddings = [
      [1, 1],
      [0, 0, 1],
    ];
    const opt = matchEmbeddingsToBullets(keywords, keywordEmbeddings, bullets, bulletEmbeddings);
    const naive = matchEmbeddingsToBulletsNaive(keywords, keywordEmbeddings, bullets, bulletEmbeddings);
    assertDeepEqualMatches(opt, naive);
  });

  it("tie-breaking: earlier bullet wins when similarity ties (strict >)", () => {
    const keywords = ["kw"];
    const bullets = ["same", "same2"];
    const keywordEmbeddings = [[1, 0]];
    const bulletEmbeddings = [
      [1, 0],
      [1, 0],
    ];
    const opt = matchEmbeddingsToBullets(keywords, keywordEmbeddings, bullets, bulletEmbeddings);
    const naive = matchEmbeddingsToBulletsNaive(keywords, keywordEmbeddings, bullets, bulletEmbeddings);
    assertDeepEqualMatches(opt, naive);
    assert.equal(opt.kw?.bullet, "same");
  });

  it("golden: empty keyword rows skipped", () => {
    const keywords = ["", "real"];
    const bullets = ["b"];
    const keywordEmbeddings = [[], [1, 0, 0]];
    const bulletEmbeddings = [[1, 0, 0]];
    const opt = matchEmbeddingsToBullets(keywords, keywordEmbeddings, bullets, bulletEmbeddings);
    const naive = matchEmbeddingsToBulletsNaive(keywords, keywordEmbeddings, bullets, bulletEmbeddings);
    assertDeepEqualMatches(opt, naive);
    assert.ok(opt.real);
  });
});

describe("cosineSimilarity", () => {
  it("returns 0 when norm is zero on prefix", () => {
    assert.equal(cosineSimilarity([0, 0], [1, 0]), 0);
  });
});

describe("embedSentences HTTP", () => {
  const prevFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = prevFetch;
    delete process.env.AI_JOB_PARSER_TIMEOUT_MS;
  });

  it("passes AbortSignal to fetch for resume/embed", async () => {
    let seenSignal: AbortSignal | undefined;
    globalThis.fetch = (async (_url, init) => {
      seenSignal = init?.signal as AbortSignal | undefined;
      return new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const out = await embedSentences(["hello"]);
    assert.ok(seenSignal);
    assert.deepEqual(out, [[0.1, 0.2]]);
  });

  it("maps fetch AbortError to Embedding service unavailable", async () => {
    globalThis.fetch = (async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    }) as typeof fetch;

    await assert.rejects(() => embedSentences(["hello"]), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as Error).message, "Embedding service unavailable");
      return true;
    });
  });

  it("getInferenceHttpTimeoutMs matches AI_JOB_PARSER_TIMEOUT_MS", () => {
    process.env.AI_JOB_PARSER_TIMEOUT_MS = "45000";
    assert.equal(getInferenceHttpTimeoutMs(), 45000);
  });

  it("getInferenceHttpTimeoutMs defaults when unset", () => {
    const prev = process.env.AI_JOB_PARSER_TIMEOUT_MS;
    delete process.env.AI_JOB_PARSER_TIMEOUT_MS;
    try {
      assert.equal(getInferenceHttpTimeoutMs(), 120_000);
    } finally {
      if (prev !== undefined) process.env.AI_JOB_PARSER_TIMEOUT_MS = prev;
    }
  });
});
