import type { AtsType } from "../../ats/ats.interface.js";

export function detectAtsType(html: string | null): AtsType | null {
  if (!html) return null;
  const lower = html.toLowerCase();

  if (lower.includes("greenhouse.io")) return "greenhouse";
  if (lower.includes("lever.co")) return "lever";
  if (lower.includes("ashbyhq.com")) return "ashby";
  if (lower.includes("myworkdayjobs.com") || lower.includes("workday")) return "workday";
  return null;
}
