import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { resolveClerkUser } from "../../infrastructure/auth/clerkVerify.js";
import { getResumeObjectStore } from "../../infrastructure/storage/resumeObjectStore.js";
import { getPlanLimits, isPro as planIsPro } from "../../config/plans.js";
import { getIoredis } from "../../queues/job.queue.js";
import { resolveProPlan } from "../../utils/userPlan.js";
import {
  peekFreeResumeMatchAiQuota,
  releaseFreeResumeMatchAiReservation,
  reserveFreeResumeMatchAiQuota,
} from "../usageQuota/resumeMatchAiQuota.js";
import { embedBullets, matchKeywordsToBullets } from "../../utils/resumeEmbedder.js";
import {
  hashResumeText,
  mimeTypeFromResumeFileName,
  normalizeResumePlainText,
  parseResumeFile,
} from "../../utils/resumeParser.js";
import { computeHasResumeFromParts, getResumeStatusRow } from "./resumePresence.js";
import { extractProfileSummary } from "../../utils/resumeProfileExtractor.js";
import { extractResumeStructured } from "../resume/extraction/pipeline.js";
import {
  buildResumeObjectKey,
  bufferToStream,
  contentTypeForResume,
  detectResumeExtension,
  sha256Hex,
} from "./resumeStorage.js";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

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

    const fileName = file.filename?.trim() || "resume";
    const buffer = await file.toBuffer();
    let mimeType = file.mimetype;
    if (!ALLOWED_MIME.has(mimeType)) {
      const fromName = mimeTypeFromResumeFileName(file.filename);
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

    const applyProfileSummary = extractProfileSummary(parsed.text, parsed.bullets);
    const resumeStructuredV1 = extractResumeStructured(parsed.text, { links: parsed.links });

    try {
      const objectStore = getResumeObjectStore();
      const hashHex = sha256Hex(buffer);
      const extension = detectResumeExtension({ fileName, mimeType });
      const objectKey = buildResumeObjectKey({
        userId: ctx.internalUserId,
        hashHex,
        extension,
      });
      const exists = await objectStore.hasObject(objectKey);
      if (!exists) {
        await objectStore.putObject({
          key: objectKey,
          body: bufferToStream(buffer),
          contentType: mimeType,
          contentLength: buffer.length,
        });
      }

      await server.prisma.user.update({
        where: { id: ctx.internalUserId },
        data: {
          resumeText: parsed.text,
          resumeFileKey: objectKey,
          resumeFileName: fileName,
          resumeFileSize: buffer.length,
          resumeFileData: null,
          resumeUpdatedAt: new Date(),
          resumeBullets: parsed.bullets,
          resumeBulletEmbeddings: embeddings,
          resumeContentHash: hashResumeText(parsed.text),
          resumeStructuredV1: resumeStructuredV1 as unknown as Prisma.InputJsonValue,
          applyProfileSummary: applyProfileSummary as unknown as Prisma.InputJsonValue,
        } as Prisma.UserUpdateInput,
      });
    } catch (err) {
      server.log.error(
        { event: "resume_upload_storage_failed", userId: ctx.internalUserId, err },
        "resume_upload_storage_failed",
      );
      return reply.status(503).send({
        error: "Service unavailable",
        message: "Resume storage unavailable",
      });
    }

    server.log.info(
      {
        event: "resume_uploaded",
        userId: ctx.internalUserId,
        fileName,
        wordCount: parsed.wordCount,
        bulletCount: parsed.bullets.length,
      },
      "smart_apply_event",
    );

    return reply.send({
      success: true,
      fileName,
      wordCount: parsed.wordCount,
      bulletCount: parsed.bullets.length,
    });
  });

  server.delete("/account/resume", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const existingRows = await server.prisma.$queryRaw<
      Array<{ resumeFileKey: string | null }>
    >`
      SELECT "resumeFileKey"
      FROM "User"
      WHERE id = ${ctx.internalUserId}
    `;
    const existing = existingRows[0] ?? null;

    if (existing?.resumeFileKey) {
      try {
        await getResumeObjectStore().deleteObject(existing.resumeFileKey);
      } catch (err) {
        server.log.warn(
          { event: "resume_object_delete_failed", userId: ctx.internalUserId, err },
          "resume_object_delete_failed",
        );
      }
    }

    await server.prisma.user.update({
      where: { id: ctx.internalUserId },
      data: {
        resumeText: null,
        resumeFileKey: null,
        resumeFileName: null,
        resumeFileSize: null,
        resumeFileData: null,
        resumeUpdatedAt: null,
        resumeContentHash: null,
        resumeBullets: Prisma.DbNull,
        resumeBulletEmbeddings: Prisma.DbNull,
        resumeStructuredV1: Prisma.DbNull,
        applyProfileSummary: Prisma.DbNull,
      } as Prisma.UserUpdateInput,
    });

    return reply.send({ success: true });
  });

  server.get("/account/resume/status", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const row = await getResumeStatusRow(server.prisma, ctx.internalUserId);
    if (!row) {
      return reply.status(404).send({ error: "User not found", code: "USER_NOT_FOUND" });
    }

    const hasResume = computeHasResumeFromParts({
      resumeText: row.resumeText,
      resumeFileName: row.resumeFileName,
      fileOctets: row.fileOctets,
    });
    const textNorm = normalizeResumePlainText(row.resumeText);
    const wordCount = textNorm.length ? textNorm.split(/\s+/).filter(Boolean).length : 0;

    return reply.send({
      hasResume,
      fileName: row.resumeFileName ?? null,
      updatedAt: row.resumeUpdatedAt?.toISOString() ?? null,
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

    const rows = await server.prisma.$queryRaw<
      Array<{
        resumeFileKey: string | null;
        resumeFileData: Uint8Array | null;
        resumeFileName: string | null;
      }>
    >`
      SELECT "resumeFileKey", "resumeFileData", "resumeFileName"
      FROM "User"
      WHERE id = ${ctx.internalUserId}
    `;
    const row = rows[0] ?? null;

    const name = row.resumeFileName ?? "resume";
    const legacyMime = mimeTypeFromResumeFileName(name);
    const fallbackType = legacyMime === "application/octet-stream" ? "application/pdf" : legacyMime;

    if (row?.resumeFileKey) {
      try {
        const object = await getResumeObjectStore().getObject(row.resumeFileKey);
        if (object) {
          const objectContentType = contentTypeForResume(
            name,
            object.contentType ?? fallbackType,
          );
          return reply
            .header("Content-Type", objectContentType)
            .header("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`)
            .send(object.stream);
        }
      } catch (err) {
        server.log.warn(
          {
            event: "resume_download_object_read_failed",
            userId: ctx.internalUserId,
            key: row.resumeFileKey,
            err,
          },
          "resume_download_object_read_failed",
        );
      }
    }

    if (!row?.resumeFileData?.length) {
      return reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });
    }

    return reply
      .header("Content-Type", fallbackType)
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`)
      .send(row.resumeFileData);
  });

  server.post("/account/resume/semantic-match", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const { plan } = await resolveProPlan(server.prisma, ctx.internalUserId, ctx.email);
    const limits = getPlanLimits(plan);
    if (!limits.resumeScore) {
      return reply.status(403).send({
        error: "Resume scoring is not available on your plan",
        code: "PLAN_BLOCKED",
      });
    }

    const pro = planIsPro(plan);
    const body = request.body as { keywords?: string[]; bullets?: string[] };
    const keywords = body.keywords ?? [];
    const fallbackBullets = body.bullets ?? [];

    const out: Record<string, { bullet: string; similarity: number }> = {};

    const row = await server.prisma.user.findUnique({
      where: { id: ctx.internalUserId },
      select: {
        resumeBullets: true,
        resumeBulletEmbeddings: true,
      },
    });
    const storedBullets = (row?.resumeBullets as string[] | null) ?? [];
    const bullets = storedBullets.length > 0 ? storedBullets : fallbackBullets;

    const sendEmpty = async () => {
      if (pro) {
        return reply.send({
          matches: out,
          matchMeta: {
            tier: "pro" as const,
            breakdownAllowed: limits.resumeBreakdown,
            quota: null,
          },
        });
      }
      try {
        const redis = getIoredis();
        const peek = await peekFreeResumeMatchAiQuota(redis, ctx.internalUserId);
        return reply.send({
          matches: out,
          matchMeta: {
            tier: "free" as const,
            breakdownAllowed: limits.resumeBreakdown,
            quota: {
              limit: peek.limit,
              used: peek.used,
              remaining: peek.remaining,
              resetAt: new Date(peek.resetAtMs).toISOString(),
            },
          },
        });
      } catch (err) {
        server.log.error(
          { event: "resume_match_ai_quota_redis_error", userId: ctx.internalUserId, err },
          "resume_match_ai_quota_redis_error",
        );
        return reply.status(503).send({
          error: "Service unavailable",
          message: "Could not verify usage limits. Please try again shortly.",
          code: "QUOTA_SERVICE_UNAVAILABLE",
        });
      }
    };

    if (!keywords.length || !bullets.length) {
      return sendEmpty();
    }

    let reservedMemberId: string | null = null;
    if (!pro) {
      try {
        const redis = getIoredis();
        const resv = await reserveFreeResumeMatchAiQuota(redis, ctx.internalUserId);
        if (!resv.ok) {
          return reply.status(429).send({
            error: "Free AI resume match limit reached for the last 24 hours.",
            code: "RESUME_MATCH_AI_QUOTA_EXCEEDED",
            limit: resv.limit,
            used: resv.used,
            remaining: 0,
            resetAt: new Date(resv.resetAtMs).toISOString(),
          });
        }
        reservedMemberId = resv.memberId;
      } catch (err) {
        server.log.error(
          { event: "resume_match_ai_quota_redis_error", userId: ctx.internalUserId, err },
          "resume_match_ai_quota_redis_error",
        );
        return reply.status(503).send({
          error: "Service unavailable",
          message: "Could not verify usage limits. Please try again shortly.",
          code: "QUOTA_SERVICE_UNAVAILABLE",
        });
      }
    }

    let embeddings = (row?.resumeBulletEmbeddings as number[][] | null) ?? [];
    const embeddingsValid =
      Array.isArray(embeddings) &&
      embeddings.length === bullets.length &&
      embeddings.every((v) => Array.isArray(v) && v.length > 0);

    try {
      if (!embeddingsValid) {
        embeddings = await embedBullets(bullets);
        if (storedBullets.length > 0 && embeddings.length === storedBullets.length) {
          await server.prisma.user.update({
            where: { id: ctx.internalUserId },
            data: { resumeBulletEmbeddings: embeddings as unknown as Prisma.InputJsonValue },
          });
        }
      }

      const matches = await matchKeywordsToBullets(keywords, bullets, embeddings);
      for (const [keyword, match] of Object.entries(matches)) {
        out[keyword] = { bullet: match.bullet, similarity: match.similarity };
      }
    } catch (err) {
      if (reservedMemberId) {
        try {
          const redis = getIoredis();
          await releaseFreeResumeMatchAiReservation(redis, ctx.internalUserId, reservedMemberId);
        } catch (releaseErr) {
          server.log.warn(
            {
              event: "resume_match_ai_quota_release_failed",
              userId: ctx.internalUserId,
              err: releaseErr,
            },
            "resume_match_ai_quota_release_failed",
          );
        }
      }
      server.log.error(
        { event: "resume_semantic_match_failed", userId: ctx.internalUserId, err },
        "resume_semantic_match_failed",
      );
      return reply.status(503).send({
        error: "Service unavailable",
        message: "Embedding or match service unavailable",
      });
    }

    if (!pro) {
      server.log.info(
        {
          event: "resume_match_ai_consumed",
          userId: ctx.internalUserId,
          plan: "free",
          keywordCount: keywords.length,
        },
        "smart_apply_event",
      );
    }

    if (pro) {
      return reply.send({
        matches: out,
        matchMeta: {
          tier: "pro" as const,
          breakdownAllowed: limits.resumeBreakdown,
          quota: null,
        },
      });
    }

    const redis = getIoredis();
    const peek = await peekFreeResumeMatchAiQuota(redis, ctx.internalUserId);
    return reply.send({
      matches: out,
      matchMeta: {
        tier: "free" as const,
        breakdownAllowed: limits.resumeBreakdown,
        quota: {
          limit: peek.limit,
          used: peek.used,
          remaining: peek.remaining,
          resetAt: new Date(peek.resetAtMs).toISOString(),
        },
      },
    });
  });
}
