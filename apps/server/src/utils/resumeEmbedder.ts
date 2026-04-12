const INFERENCE_URL =
  process.env.AI_JOB_PARSER_URL?.trim() ||
  process.env.JOB_PARSER_SERVICE_URL?.trim() ||
  "http://localhost:8001";

export async function embedBullets(bullets: string[]): Promise<number[][]> {
  if (!bullets.length) return [];

  const res = await fetch(`${INFERENCE_URL}/resume/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sentences: bullets }),
  });

  if (!res.ok) throw new Error("Embedding service unavailable");
  const data = (await res.json()) as { embeddings: number[][] };
  return data.embeddings;
}

export async function findClosestBullet(
  keyword: string,
  bullets: string[],
): Promise<{ bullet: string; similarity: number } | null> {
  if (!bullets.length) return null;

  const res = await fetch(`${INFERENCE_URL}/resume/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyword, bullets }),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { best_match: string | null; similarity: number };
  if (data.best_match == null) return null;
  return { bullet: data.best_match, similarity: data.similarity };
}
