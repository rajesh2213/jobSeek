import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeDomain } from "./common.js";
import { companyNameAliasKeys } from "./companyNameCanonical.js";

export interface CompanyBulkHint {
  domain?: string;
  wellfoundUrl?: string;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      result.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function serverRootDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "..");
}

const CSV_FILES = [
  ["data", "company-datasets", "companies.csv"],
  ["src", "modules", "seeding", "data", "Wellfound_Final.csv"],
] as const;

let bulkHintMap: Map<string, CompanyBulkHint> | null = null;

function extractHostnameFromWebsite(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const trimmed = raw.trim();
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(withProtocol).hostname.toLowerCase();
    if (!host) return undefined;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return undefined;
  }
}

function loadBulkHintsFromDisk(): Map<string, CompanyBulkHint> {
  const map = new Map<string, CompanyBulkHint>();
  const root = serverRootDir();

  for (const segments of CSV_FILES) {
    const filePath = path.join(root, ...segments);
    if (!fs.existsSync(filePath)) continue;

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length < 2) continue;

    const headerLine = lines[0]!.replace(/^\uFEFF/, "");
    const headers = parseCsvLine(headerLine).map((h) => h.trim().toLowerCase());
    const nameIdx = headers.indexOf("company name");
    const websiteIdx = headers.indexOf("company website url");
    const wfIdx = headers.indexOf("wellfound url");
    if (nameIdx < 0) continue;

    for (let i = 1; i < lines.length; i += 1) {
      const cells = parseCsvLine(lines[i]!);
      const name = cells[nameIdx]?.trim() ?? "";
      const aliasKeys = companyNameAliasKeys(name);
      if (aliasKeys.length === 0) continue;

      const website = websiteIdx >= 0 ? cells[websiteIdx]?.trim() : undefined;
      const wellfoundRaw = wfIdx >= 0 ? cells[wfIdx]?.trim() : undefined;
      const domain = extractHostnameFromWebsite(website);
      const wellfoundUrl =
        wellfoundRaw && /^https?:\/\//i.test(wellfoundRaw)
          ? wellfoundRaw
          : wellfoundRaw
            ? `https://${wellfoundRaw.replace(/^\/\//, "")}`
            : undefined;

      const hint: CompanyBulkHint = {};
      if (domain) {
        const d = normalizeDomain(domain);
        if (d) hint.domain = d;
      }
      if (wellfoundUrl) hint.wellfoundUrl = wellfoundUrl;

      if (!hint.domain && !hint.wellfoundUrl) continue;

      for (const key of aliasKeys) {
        if (!key) continue;
        const existing = map.get(key);
        if (!existing) {
          map.set(key, { ...hint });
        } else {
          if (!existing.domain && hint.domain) existing.domain = hint.domain;
          if (!existing.wellfoundUrl && hint.wellfoundUrl) {
            existing.wellfoundUrl = hint.wellfoundUrl;
          }
        }
      }
    }
  }

  return map;
}

/**
 * O(1) lookup from preloaded CSV exports (e.g. Wellfound 12k + companies.csv).
 * Tries canonical + alias keys so "Stripe Inc." matches "Stripe".
 */
export function getBulkCompanyHint(companyName: string): CompanyBulkHint | undefined {
  if (!bulkHintMap) bulkHintMap = loadBulkHintsFromDisk();
  for (const key of companyNameAliasKeys(companyName)) {
    const h = bulkHintMap.get(key);
    if (h && (h.domain || h.wellfoundUrl)) return h;
  }
  return undefined;
}

export function ensureBulkHintsLoaded(): void {
  if (!bulkHintMap) bulkHintMap = loadBulkHintsFromDisk();
}

export function bulkHintMapSize(): number {
  if (!bulkHintMap) bulkHintMap = loadBulkHintsFromDisk();
  return bulkHintMap.size;
}
