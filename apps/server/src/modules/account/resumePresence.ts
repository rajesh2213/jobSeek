import type { PrismaClient } from "@prisma/client";
import { normalizeResumePlainText } from "../../utils/resumeParser.js";

/** Lightweight row for /account/resume/status (no full BYTEA load). */
export async function getResumeStatusRow(
  prisma: PrismaClient,
  userId: string,
): Promise<{
  resumeText: string | null;
  resumeFileName: string | null;
  resumeUpdatedAt: Date | null;
  fileOctets: bigint | null;
} | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      resumeText: string | null;
      resumeFileName: string | null;
      resumeUpdatedAt: Date | null;
      fileOctets: bigint | null;
    }>
  >`
    SELECT "resumeText", "resumeFileName", "resumeUpdatedAt",
      COALESCE("resumeFileSize"::bigint, octet_length("resumeFileData")) AS "fileOctets"
    FROM "User"
    WHERE id = ${userId}
  `;
  return rows[0] ?? null;
}

export async function getResumeFileOctetLength(
  prisma: PrismaClient,
  userId: string,
): Promise<bigint | null> {
  const rows = await prisma.$queryRaw<[{ n: bigint | null }]>`
    SELECT COALESCE("resumeFileSize"::bigint, octet_length("resumeFileData")) AS n
    FROM "User"
    WHERE id = ${userId}
  `;
  return rows[0]?.n ?? null;
}

export function computeHasResumeFromParts(input: {
  resumeText: string | null | undefined;
  resumeFileName: string | null | undefined;
  fileOctets: bigint | null | undefined;
}): boolean {
  const name = input.resumeFileName?.trim();
  if (!name) return false;
  const text = normalizeResumePlainText(input.resumeText ?? null);
  const hasBytes = input.fileOctets != null && input.fileOctets > 0n;
  return text.length > 0 || hasBytes;
}
