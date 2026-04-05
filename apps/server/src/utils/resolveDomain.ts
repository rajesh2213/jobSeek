import type { PrismaClient } from "@prisma/client";
import { normalizeDomain } from "./common.js";
import { getBulkCompanyHint } from "./companyBulkHints.js";
import { canonicalCompanyNameKey, companyNameAliasKeys } from "./companyNameCanonical.js";
import { getEnterpriseDataset } from "../modules/seeding/datasets/enterprise.dataset.js";
import { getExtendedDataset } from "../modules/seeding/datasets/extended.dataset.js";
import { getGithubDataset } from "../modules/seeding/datasets/github.dataset.js";
import { getStartupsDataset } from "../modules/seeding/datasets/startups.dataset.js";
import { getYcDataset } from "../modules/seeding/datasets/yc.dataset.js";

const CORPORATE_SUFFIX =
  /\b(inc\.?|llc|l\.?l\.?c\.?|ltd\.?|limited|corp\.?|corporation|plc|gmbh|ag|sa|bv|nv|co\.?)\b/gi;

function normalizeNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function nameToBaseHost(companyName: string): string {
  let s = companyName
    .split(",")[0]!
    .replace(CORPORATE_SUFFIX, "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 48);
  return s || "company";
}

async function hostResponds(hostname: string): Promise<boolean> {
  const url = `https://${hostname}`;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
    });
    return res.ok || (res.status >= 300 && res.status < 400);
  } catch {
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
        headers: { accept: "text/html,*/*" },
      });
      return res.ok || (res.status >= 300 && res.status < 400);
    } catch {
      return false;
    }
  }
}

/** User-facing order: .com and .io first, then other common TLDs. */
const HEURISTIC_TLDS = ["com", "io", "ai", "co"] as const;

let seedDomainMap: Map<string, string> | null = null;

function getSeedDomainMap(): Map<string, string> {
  if (seedDomainMap) return seedDomainMap;
  seedDomainMap = new Map<string, string>();
  const lists = [
    getExtendedDataset(),
    getYcDataset(),
    getStartupsDataset(),
    getGithubDataset(),
    getEnterpriseDataset(),
  ];
  for (const list of lists) {
    for (const row of list) {
      if (!row.domain?.trim()) continue;
      const d = normalizeDomain(row.domain);
      if (!d) continue;
      for (const key of companyNameAliasKeys(row.name)) {
        if (!key) continue;
        if (!seedDomainMap.has(key)) seedDomainMap.set(key, d);
      }
    }
  }
  return seedDomainMap;
}

async function resolveDomainFromDb(
  prisma: PrismaClient,
  companyName: string,
  excludeCompanyId: string,
): Promise<string | null> {
  const trimmed = companyName.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  try {
    const row = await prisma.company.findFirst({
      where: {
        id: { not: excludeCompanyId },
        domain: { not: null },
        name: { equals: trimmed, mode: "insensitive" },
      },
      select: { domain: true },
    });
    const d = row?.domain;
    return d ? normalizeDomain(d) ?? null : null;
  } catch {
    return null;
  }
}

async function probeHeuristicHosts(companyName: string): Promise<string | null> {
  const base = nameToBaseHost(companyName);
  for (const tld of HEURISTIC_TLDS) {
    const host = `${base}.${tld}`;
    if (await hostResponds(host)) return host;
  }
  return null;
}

/**
 * Resolve hostname (no scheme): bulk CSV (12k+) → seed datasets → DB match → name.com / name.io / …
 */
export async function resolveDomain(
  prisma: PrismaClient,
  companyName: string,
  excludeCompanyId: string,
): Promise<string | null> {
  const key = normalizeNameKey(companyName);
  if (!key) return null;

  const fromBulk = getBulkCompanyHint(companyName)?.domain;
  if (fromBulk) return fromBulk;

  let fromSeed = getSeedDomainMap().get(key);
  if (!fromSeed) {
    fromSeed = getSeedDomainMap().get(canonicalCompanyNameKey(companyName));
  }
  if (fromSeed) return fromSeed;

  const fromDb = await resolveDomainFromDb(prisma, companyName, excludeCompanyId);
  if (fromDb) return fromDb;

  return probeHeuristicHosts(companyName);
}
