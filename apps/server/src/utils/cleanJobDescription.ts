/**
 * Strip HTML tags and scripts for API responses (plain text only).
 * Not a full sanitizer — sufficient for job description snippets.
 */
export function cleanJobDescription(html: string | null | undefined): string | null {
  if (html == null) return null;
  const s = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const noTags = s.replace(/<[^>]*>/g, " ");
  const text = noTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text : null;
}
