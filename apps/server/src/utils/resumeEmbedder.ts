const INFERENCE_URL =
  process.env.AI_JOB_PARSER_URL?.trim() ||
  process.env.JOB_PARSER_SERVICE_URL?.trim() ||
  "http://localhost:8001";

/** Same default as `createClient()` in `modules/ai/ai.service.ts` (Axios `/parse`). */
const DEFAULT_INFERENCE_HTTP_TIMEOUT_MS = 120_000;

export function getInferenceHttpTimeoutMs(): number {
  const v = Number(process.env.AI_JOB_PARSER_TIMEOUT_MS ?? DEFAULT_INFERENCE_HTTP_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 1 ? v : DEFAULT_INFERENCE_HTTP_TIMEOUT_MS;
}

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  if (e instanceof Error && e.name === "AbortError") return true;
  return false;
}

/** Cosine similarity on the overlapping prefix min(|a|,|b|) (matches prior behavior). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function normSqPrefix(v: number[], len: number): number {
  let s = 0;
  for (let i = 0; i < len; i++) {
    const t = v[i] ?? 0;
    s += t * t;
  }
  return s;
}

function dotPrefix(a: number[], b: number[], len: number): number {
  let s = 0;
  for (let i = 0; i < len; i++) {
    s += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return s;
}

/** When every non-empty row shares one dimension, cosine reduces to fixed-length dot / norms. */
function uniformEmbeddingDim(keywordEmbeddings: number[][], bulletEmbeddings: number[][]): number | null {
  let d: number | null = null;
  for (const v of keywordEmbeddings) {
    if (!Array.isArray(v) || v.length === 0) continue;
    if (d === null) d = v.length;
    else if (v.length !== d) return null;
  }
  for (const v of bulletEmbeddings) {
    if (!Array.isArray(v) || v.length === 0) continue;
    if (d === null) d = v.length;
    else if (v.length !== d) return null;
  }
  return d;
}

/**
 * Match keywords to best bullet by cosine similarity (same semantics as the previous nested-loop implementation).
 * Exposed for unit tests; call sites use {@link matchKeywordsToBullets} which fetches keyword embeddings first.
 */
export function matchEmbeddingsToBullets(
  keywords: string[],
  keywordEmbeddings: number[][],
  bullets: string[],
  bulletEmbeddings: number[][],
): Record<string, { bullet: string; similarity: number }> {
  const out: Record<string, { bullet: string; similarity: number }> = {};
  if (!keywords.length || !bullets.length || !bulletEmbeddings.length) return out;

  const dim = uniformEmbeddingDim(keywordEmbeddings, bulletEmbeddings);

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i] ?? "";
    const kvec = keywordEmbeddings[i];
    if (!kw || !Array.isArray(kvec) || kvec.length === 0) continue;
    let bestIdx = -1;
    let best = -1;

    if (dim !== null && kvec.length === dim) {
      const na = normSqPrefix(kvec, dim);
      if (na <= 0) continue;
      const sqrtNa = Math.sqrt(na);
      for (let j = 0; j < bulletEmbeddings.length; j++) {
        const bvec = bulletEmbeddings[j];
        if (!Array.isArray(bvec) || bvec.length !== dim) continue;
        const nb = normSqPrefix(bvec, dim);
        if (nb <= 0) continue;
        const dot = dotPrefix(kvec, bvec, dim);
        const sim = dot / (sqrtNa * Math.sqrt(nb));
        if (sim > best) {
          best = sim;
          bestIdx = j;
        }
      }
    } else {
      for (let j = 0; j < bulletEmbeddings.length; j++) {
        const bvec = bulletEmbeddings[j];
        if (!Array.isArray(bvec) || bvec.length === 0) continue;
        const sim = cosineSimilarity(kvec, bvec);
        if (sim > best) {
          best = sim;
          bestIdx = j;
        }
      }
    }

    if (bestIdx >= 0 && bullets[bestIdx]) {
      out[kw] = { bullet: bullets[bestIdx], similarity: best };
    }
  }
  return out;
}

export async function embedSentences(sentences: string[]): Promise<number[][]> {
  if (!sentences.length) return [];
  const ms = getInferenceHttpTimeoutMs();
  let res: Response;
  try {
    res = await fetch(`${INFERENCE_URL}/resume/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentences }),
      signal: AbortSignal.timeout(ms),
    });
  } catch (e) {
    if (isAbortError(e)) {
      throw new Error("Embedding service unavailable");
    }
    throw e;
  }

  if (!res.ok) throw new Error("Embedding service unavailable");
  const data = (await res.json()) as { embeddings: number[][] };
  return data.embeddings;
}

export async function embedBullets(bullets: string[]): Promise<number[][]> {
  return embedSentences(bullets);
}

export async function matchKeywordsToBullets(
  keywords: string[],
  bullets: string[],
  bulletEmbeddings: number[][],
): Promise<Record<string, { bullet: string; similarity: number }>> {
  if (!keywords.length || !bullets.length || !bulletEmbeddings.length) return {};
  const keywordEmbeddings = await embedSentences(keywords);
  return matchEmbeddingsToBullets(keywords, keywordEmbeddings, bullets, bulletEmbeddings);
}

export async function findClosestBullet(
  keyword: string,
  bullets: string[],
): Promise<{ bullet: string; similarity: number } | null> {
  if (!bullets.length) return null;
  const out = await matchKeywordsToBullets(keyword ? [keyword] : [], bullets, await embedBullets(bullets));
  const m = out[keyword];
  if (!m) return null;
  return m;
}
