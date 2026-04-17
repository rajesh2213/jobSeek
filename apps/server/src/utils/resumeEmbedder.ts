const INFERENCE_URL =
  process.env.AI_JOB_PARSER_URL?.trim() ||
  process.env.JOB_PARSER_SERVICE_URL?.trim() ||
  "http://localhost:8001";

function cosineSimilarity(a: number[], b: number[]): number {
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

export async function embedSentences(sentences: string[]): Promise<number[][]> {
  if (!sentences.length) return [];
  const res = await fetch(`${INFERENCE_URL}/resume/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sentences }),
  });

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
  const out: Record<string, { bullet: string; similarity: number }> = {};
  if (!keywords.length || !bullets.length || !bulletEmbeddings.length) return out;
  const keywordEmbeddings = await embedSentences(keywords);
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
