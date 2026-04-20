import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { mimeTypeFromResumeFileName } from "../../utils/resumeParser.js";

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
};

export function sha256Hex(input: Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

function extensionForFileName(fileName: string): string {
  const parts = fileName.split(".");
  if (parts.length < 2) return "";
  return parts[parts.length - 1]!.toLowerCase();
}

export function detectResumeExtension(input: {
  fileName: string;
  mimeType: string;
}): string {
  const fromName = extensionForFileName(input.fileName);
  if (fromName === "pdf" || fromName === "docx" || fromName === "txt") {
    return fromName;
  }
  return EXT_BY_MIME[input.mimeType] ?? "pdf";
}

export function buildResumeObjectKey(input: {
  userId: string;
  hashHex: string;
  extension: string;
}): string {
  return `resumes/${input.userId}/${input.hashHex}.${input.extension}`;
}

export function contentTypeForResume(fileName: string, fallback: string): string {
  const fromName = mimeTypeFromResumeFileName(fileName);
  if (fromName !== "application/octet-stream") return fromName;
  return fallback;
}

export function bufferToStream(buffer: Buffer): Readable {
  return Readable.from(buffer);
}
