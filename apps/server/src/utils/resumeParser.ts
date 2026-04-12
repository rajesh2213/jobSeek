import mammoth from "mammoth";
import pdfParse from "pdf-parse";

export interface ParsedResume {
  text: string;
  bullets: string[];
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

  return {
    text,
    bullets,
    wordCount: text.split(/\s+/).filter(Boolean).length,
  };
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
