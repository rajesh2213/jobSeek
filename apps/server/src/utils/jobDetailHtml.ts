import { sanitizeHtml } from "../modules/ats/ats.interface.js";

export type JobDescriptionHtmlSource = "jsonld" | "meta" | "main" | "body" | "none";

function stripTags(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function extractMetaDescription(html: string): string {
  const m = html.match(
    /<meta\s+[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']/i,
  );
  if (m?.[1]) return decodeBasicEntities(m[1].trim());
  const m2 = html.match(
    /<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["']/i,
  );
  return m2?.[1] ? decodeBasicEntities(m2[1].trim()) : "";
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function isJobPostingNode(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const t = (node as { "@type"?: unknown })["@type"];
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) =>
    String(x ?? "")
      .toLowerCase()
      .includes("jobposting"),
  );
}

function descriptionFromJsonLdNode(node: Record<string, unknown>): string {
  const d = node.description;
  if (typeof d === "string") return d;
  if (d && typeof d === "object" && "value" in d && typeof (d as { value: unknown }).value === "string") {
    return (d as { value: string }).value;
  }
  return "";
}

function extractJsonLdJobPostingDescription(html: string): string {
  const scriptRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as unknown;
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        if (isJobPostingNode(node)) {
          const text = descriptionFromJsonLdNode(node as Record<string, unknown>);
          if (text) return text;
        }
        const g = (node as Record<string, unknown>)["@graph"];
        if (Array.isArray(g)) {
          for (const sub of g) {
            if (sub && typeof sub === "object" && isJobPostingNode(sub)) {
              const text = descriptionFromJsonLdNode(sub as Record<string, unknown>);
              if (text) return text;
            }
          }
        }
      }
    } catch {
      /* invalid JSON-LD */
    }
  }
  return "";
}

function extractMainlikeInnerText(html: string): string {
  const chunkRe = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  let best = "";
  while ((m = chunkRe.exec(html)) !== null) {
    const inner = m[2] ?? "";
    const plain = stripTags(inner);
    if (plain.length > best.length) best = plain;
  }
  return best;
}

const MIN_MEANINGFUL_LEN = 120;

/**
 * Extract plain-text job description from arbitrary job-detail HTML.
 * Priority: JSON-LD JobPosting → meta description → main/article → stripped body.
 */
export function extractJobDescriptionFromHtml(html: string): {
  text: string;
  source: JobDescriptionHtmlSource;
} {
  const jsonldRaw = extractJsonLdJobPostingDescription(html);
  const jsonldPlain = normalizeWs(sanitizeHtml(jsonldRaw) ?? stripTags(jsonldRaw));

  const metaRaw = extractMetaDescription(html);

  const mainRaw = extractMainlikeInnerText(html);
  const mainPlain = normalizeWs(mainRaw);

  const bodyPlain = normalizeWs(stripTags(html));

  const candidates: Array<{ text: string; source: JobDescriptionHtmlSource }> = [
    { text: jsonldPlain, source: "jsonld" },
    { text: metaRaw, source: "meta" },
    { text: mainPlain, source: "main" },
    { text: bodyPlain, source: "body" },
  ];

  for (const c of candidates) {
    if (c.text.length >= MIN_MEANINGFUL_LEN) {
      return { text: c.text, source: c.source };
    }
  }

  const best = candidates.reduce((a, b) => (b.text.length > a.text.length ? b : a));
  if (best.text.length > 0) {
    return { text: best.text, source: best.source };
  }
  return { text: "", source: "none" };
}
