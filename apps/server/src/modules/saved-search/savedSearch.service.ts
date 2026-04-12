import type { PrismaClient } from "@prisma/client";
import { parseJobDiscoveryQuery } from "../../utils/taxonomyQuery.js";

const ALLOWED_QUERY_KEYS = new Set([
  "page",
  "limit",
  "offset",
  "role",
  "roles",
  "skills",
  "country",
  "locations",
  "category",
  "remote",
  "workType",
  "types",
  "experience",
  "posted",
  "minSalary",
  "companyId",
  "location",
  "sort",
]);

const QUERY_ONLY_DROP_KEYS = new Set(["page", "limit", "offset"]);

function toObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) {
    out[k] = v;
  }
  return out;
}

function decodeComma(value: string): string {
  return value.replace(/%2C/gi, ",");
}

export function normalizeQuery(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Query is required");
  }

  const base = "https://jobseek.local";
  const parsed = new URL(trimmed.startsWith("http") ? trimmed : `${base}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`);

  if (!parsed.pathname.startsWith("/jobs")) {
    throw new Error("Query must start with /jobs");
  }

  const normalizedParams = new URLSearchParams();
  const sorted = Array.from(parsed.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [k, raw] of sorted) {
    const key = k.trim();
    const value = decodeComma(raw.trim());
    if (!key || !value) continue;
    if (!ALLOWED_QUERY_KEYS.has(key)) continue;
    if (QUERY_ONLY_DROP_KEYS.has(key)) continue;
    normalizedParams.append(key, value);
  }

  const query = normalizedParams.toString();
  return query ? `/jobs?${query}` : "/jobs";
}

export function isValidQuery(normalizedQuery: string): boolean {
  if (!normalizedQuery.startsWith("/jobs")) return false;
  const parsed = new URL(`https://jobseek.local${normalizedQuery}`);
  if (parsed.pathname !== "/jobs") return false;

  const params = parsed.searchParams;
  if (Array.from(params.keys()).length === 0) return false;

  for (const [k, v] of params.entries()) {
    if (!ALLOWED_QUERY_KEYS.has(k)) return false;
    if (!v.trim()) return false;
  }

  const parsedFilters = parseJobDiscoveryQuery(toObject(params));
  return Object.keys(parsedFilters).length > 0;
}

export async function getUserSavedSearchCount(prisma: PrismaClient, userId: string): Promise<number> {
  return prisma.savedSearch.count({ where: { userId } });
}

/** Next default label for a new saved search: lowest free `Saved search 1` … `3` (max 3 rows per user). */
export async function resolveDefaultSavedSearchName(
  prisma: PrismaClient,
  userId: string,
): Promise<string> {
  const rows = await prisma.savedSearch.findMany({
    where: { userId },
    select: { name: true },
  });
  const used = new Set<number>();
  for (const row of rows) {
    const m = row.name?.trim().match(/^Saved search (\d+)$/i);
    if (m) used.add(Number(m[1]));
  }
  for (let i = 1; i <= 3; i += 1) {
    if (!used.has(i)) return `Saved search ${i}`;
  }
  return `Saved search ${rows.length + 1}`;
}
