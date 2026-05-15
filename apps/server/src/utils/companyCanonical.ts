import type { Company } from "@prisma/client";
import { companyDisplayName } from "./companyDisplayName.js";

export type CompanyCanonicalPick = Pick<
  Company,
  "id" | "name" | "domain" | "discoverySource" | "isCompanyVerified" | "status" | "atsType" | "atsBoardToken"
>;

/** Prefer human-verified / complete company rows when ATS board tokens collide. */
export function scoreCompanyCanonicalPreference(c: CompanyCanonicalPick): number {
  const display = companyDisplayName(c.name, c.domain).trim();
  let score = display.length * 3;
  if (c.discoverySource === "api_manual") score += 80;
  if (c.isCompanyVerified) score += 40;
  if (c.status === "ready") score += 25;
  if (c.domain?.trim()) score += 10;
  const raw = c.name.trim();
  if (/^[A-Z]{3,8}$/.test(raw) && raw.length <= 6) score -= 50;
  return score;
}

export function pickCanonicalCompany<T extends CompanyCanonicalPick>(
  candidates: T[],
): T | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  let best = candidates[0]!;
  let bestScore = scoreCompanyCanonicalPreference(best);
  for (let i = 1; i < candidates.length; i += 1) {
    const c = candidates[i]!;
    const s = scoreCompanyCanonicalPreference(c);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}
