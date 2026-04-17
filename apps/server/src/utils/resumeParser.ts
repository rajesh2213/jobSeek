import { createHash } from "node:crypto";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";

/** Normalized SHA-256 of resume text (scoring / dedupe). */
export function hashResumeText(text: string): string {
  const n = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(n, "utf8").digest("hex");
}

/** Strip invisible chars so empty / ZWSP-only content is treated as no text (extract + status). */
export function normalizeResumePlainText(s: string | null | undefined): string {
  if (s == null) return "";
  return s
    .replace(/\u200b/g, "")
    .replace(/\u200c/g, "")
    .replace(/\u200d/g, "")
    .replace(/\ufeff/g, "")
    .trim();
}

/** MIME guess from stored filename (matches upload route). */
export function mimeTypeFromResumeFileName(fileName: string | undefined): string {
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

export interface ParsedResume {
  text: string;
  bullets: string[];
  links: string[];
  wordCount: number;
}

export async function parseResumeFile(buffer: Buffer, mimeType: string): Promise<ParsedResume> {
  let text = "";

  if (mimeType === "application/pdf") {
    const result = await pdfParse(buffer);
    text = result.text;
  } else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (mimeType === "text/plain") {
    text = buffer.toString("utf8");
  } else {
    throw new Error("Unsupported file type. Please upload PDF or DOCX.");
  }

  // Clean text
  text = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Extract bullet-like sentences (lines that look like resume bullets)
  const bullets = extractBullets(text);
  const links = extractResumeLinks(text, buffer, mimeType);

  return {
    text,
    bullets,
    links,
    wordCount: text.split(/\s+/).filter(Boolean).length,
  };
}

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/[.,;)\]>'"]+$/g, "");
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

function collectUrls(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"')\]]+/gi)) {
    const normalized = normalizeUrl(m[0]);
    if (normalized) out.add(normalized);
  }
  for (const m of text.matchAll(/\bwww\.[^\s<>"')\]]+/gi)) {
    const raw = m[0];
    const normalized = normalizeUrl(raw);
    if (normalized) out.add(normalized);
  }
  for (const m of text.matchAll(/\b(?:linkedin\.com|github\.com)\/[^\s<>"')\]]+/gi)) {
    const normalized = normalizeUrl(m[0]);
    if (normalized) out.add(normalized);
  }
  for (const m of text.matchAll(/\b[a-z0-9.-]+\.[a-z]{2,}\/[^\s<>"')\]]+/gi)) {
    const normalized = normalizeUrl(m[0]);
    if (normalized) out.add(normalized);
  }
  return [...out];
}

function extractPdfAnnotationUrls(buffer: Buffer): string[] {
  const out = new Set<string>();
  const raw = buffer.toString("latin1");
  for (const m of raw.matchAll(/\/URI\s*\(([^)]+)\)/g)) {
    const normalized = normalizeUrl(m[1] ?? "");
    if (normalized) out.add(normalized);
  }
  for (const m of raw.matchAll(/\/URI\s*<([^>]+)>/g)) {
    const hex = m[1] ?? "";
    if (!hex || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) continue;
    try {
      const decoded = Buffer.from(hex, "hex").toString("utf8");
      const normalized = normalizeUrl(decoded);
      if (normalized) out.add(normalized);
    } catch {
      // ignore malformed hex entries
    }
  }
  return [...out];
}

/**
 * Pull URLs from parsed text first, then binary hints (PDF annotations / DOCX relationship payload).
 * This recovers links when visible text only contains labels like "GitHub | LinkedIn | Portfolio".
 */
function extractResumeLinks(text: string, buffer: Buffer, mimeType: string): string[] {
  const out = new Set<string>();
  for (const u of collectUrls(text)) out.add(u);
  const binaryAsText = buffer.toString("latin1");
  for (const u of collectUrls(binaryAsText)) out.add(u);
  if (mimeType === "application/pdf") {
    for (const u of extractPdfAnnotationUrls(buffer)) out.add(u);
  }
  return [...out];
}

function extractBullets(text: string): string[] {
  const lines = text.split("\n");
  const bullets: string[] = [];

  for (const line of lines) {
    const cleaned = line
      .replace(/^[\s•\-–—▪▸►✓✔*]+/, "") // strip bullet chars
      .trim();

    // Keep lines that look like experience bullets:
    // - 20-200 chars
    // - Contains a verb or skill keyword
    // - Not a section header (not ALL CAPS short)
    if (
      cleaned.length >= 20 &&
      cleaned.length <= 300 &&
      !/^[A-Z\s]{2,30}$/.test(cleaned) // not ALL CAPS header
    ) {
      bullets.push(cleaned);
    }
  }

  // Deduplicate
  return [...new Set(bullets)];
}
