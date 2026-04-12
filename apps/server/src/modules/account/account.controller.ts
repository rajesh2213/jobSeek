import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { resolveClerkUser } from "../../infrastructure/auth/clerkVerify.js";
import { embedBullets, findClosestBullet } from "../../utils/resumeEmbedder.js";
import { parseResumeFile } from "../../utils/resumeParser.js";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

function mimeFromFileName(fileName: string | undefined): string {
  const n = (fileName ?? "").toLowerCase();
  if (n.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (n.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (n.endsWith(".txt")) {
    return "text/plain";
  }
  return "application/octet-stream";
}

async function runParallelLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export function registerAccountResumeRoutes(server: FastifyInstance): void {
  server.post("/account/resume", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ error: "Bad request", message: "Missing resume file" });
    }

    const buffer = await file.toBuffer();
    let mimeType = file.mimetype;
    if (!ALLOWED_MIME.has(mimeType)) {
      const fromName = mimeFromFileName(file.filename);
      if (ALLOWED_MIME.has(fromName)) {
        mimeType = fromName;
      }
    }

    if (!ALLOWED_MIME.has(mimeType)) {
      return reply.status(400).send({
        error: "Bad request",
        message: "Unsupported file type. Please upload PDF or Word document (.docx).",
      });
    }
    if (buffer.length > MAX_BYTES) {
      return reply.status(400).send({
        error: "Bad request",
        message: "File too large. Maximum size is 5MB",
      });
    }

    let parsed;
    try {
      parsed = await parseResumeFile(buffer, mimeType);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to parse resume";
      return reply.status(400).send({ error: "Bad request", message: msg });
    }

    let embeddings: number[][];
    try {
      embeddings = await embedBullets(parsed.bullets);
    } catch {
      return reply.status(503).send({
        error: "Service unavailable",
        message: "Embedding service unavailable",
      });
    }

    await server.prisma.user.update({
      where: { id: ctx.internalUserId },
      data: {
        resumeText: parsed.text,
        resumeFileName: file.filename ?? "resume",
        resumeFileData: buffer,
        resumeUpdatedAt: new Date(),
        resumeBullets: parsed.bullets,
        resumeBulletEmbeddings: embeddings,
      },
    });

    return reply.send({
      success: true,
      fileName: file.filename ?? "resume",
      wordCount: parsed.wordCount,
      bulletCount: parsed.bullets.length,
    });
  });

  server.delete("/account/resume", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    await server.prisma.user.update({
      where: { id: ctx.internalUserId },
      data: {
        resumeText: null,
        resumeFileName: null,
        resumeFileData: null,
        resumeUpdatedAt: null,
        resumeBullets: Prisma.DbNull,
        resumeBulletEmbeddings: Prisma.DbNull,
      },
    });

    return reply.send({ success: true });
  });

  server.get("/account/resume/status", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const row = await server.prisma.user.findUnique({
      where: { id: ctx.internalUserId },
      select: { resumeText: true, resumeFileName: true, resumeUpdatedAt: true },
    });

    const hasResume = !!(row?.resumeText?.trim() && row?.resumeFileName);
    const wordCount = row?.resumeText?.trim()
      ? row.resumeText.split(/\s+/).filter(Boolean).length
      : 0;

    return reply.send({
      hasResume,
      fileName: row?.resumeFileName ?? null,
      updatedAt: row?.resumeUpdatedAt?.toISOString() ?? null,
      wordCount,
    });
  });

  server.get("/account/resume/text", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const row = await server.prisma.user.findUnique({
      where: { id: ctx.internalUserId },
      select: { resumeText: true, resumeBullets: true },
    });

    const bullets = (row?.resumeBullets as string[] | null) ?? [];

    return reply.send({
      text: row?.resumeText ?? "",
      bullets,
    });
  });

  server.get("/account/resume/download", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const row = await server.prisma.user.findUnique({
      where: { id: ctx.internalUserId },
      select: { resumeFileData: true, resumeFileName: true },
    });

    if (!row?.resumeFileData?.length) {
      return reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });
    }

    const name = row.resumeFileName ?? "resume";
    const mime = mimeFromFileName(name);
    const contentType =
      mime === "application/octet-stream" ? "application/pdf" : mime;

    return reply
      .header("Content-Type", contentType)
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`)
      .send(row.resumeFileData);
  });

  server.post("/account/resume/semantic-match", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const body = request.body as { keywords?: string[]; bullets?: string[] };
    const keywords = body.keywords ?? [];
    const bullets = body.bullets ?? [];

    const out: Record<string, { bullet: string; similarity: number }> = {};

    if (!keywords.length || !bullets.length) {
      return reply.send(out);
    }

    const results = await runParallelLimit(keywords, 10, async (keyword) => {
      const match = await findClosestBullet(keyword, bullets);
      return { keyword, match };
    });

    for (const { keyword, match } of results) {
      if (match) {
        out[keyword] = { bullet: match.bullet, similarity: match.similarity };
      }
    }

    return reply.send(out);
  });
}
