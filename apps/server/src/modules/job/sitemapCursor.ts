import { Prisma } from "@prisma/client";

/** Row returned by {@link findManyCanonicalForSitemap} — sitemap-only fields. */
export interface SitemapJobRow {
  id: string;
  postedAt: Date | null;
  createdAt: Date;
  listingFreshnessAt: Date;
}

export interface SitemapJobCursor {
  postedAt: Date | null;
  listingFreshnessAt: Date;
  createdAt: Date;
  id: string;
}

function parseIsoDate(raw: string, field: string): Date {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`invalid_cursor_date_${field}`);
  }
  return d;
}

/** Opaque cursor for keyset pagination (base64url JSON). */
export function encodeSitemapJobCursor(row: SitemapJobCursor): string {
  const payload = JSON.stringify({
    p: row.postedAt?.toISOString() ?? null,
    lf: row.listingFreshnessAt.toISOString(),
    c: row.createdAt.toISOString(),
    i: row.id,
  });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeSitemapJobCursor(raw: string | null | undefined): SitemapJobCursor | null {
  if (!raw?.trim()) return null;
  let parsed: { p?: string | null; lf?: string; c?: string; i?: string };
  try {
    const json = Buffer.from(raw.trim(), "base64url").toString("utf8");
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    throw new Error("invalid_cursor_encoding");
  }
  if (typeof parsed.i !== "string" || !parsed.i.trim()) {
    throw new Error("invalid_cursor_id");
  }
  if (typeof parsed.lf !== "string" || typeof parsed.c !== "string") {
    throw new Error("invalid_cursor_keys");
  }
  return {
    postedAt: parsed.p === null || parsed.p === undefined ? null : parseIsoDate(parsed.p, "postedAt"),
    listingFreshnessAt: parseIsoDate(parsed.lf, "listingFreshnessAt"),
    createdAt: parseIsoDate(parsed.c, "createdAt"),
    id: parsed.i.trim(),
  };
}

/**
 * Keyset predicate for rows strictly after `cursor` in:
 *   ORDER BY postedAt DESC NULLS LAST, listingFreshnessAt DESC, createdAt DESC, id ASC
 *
 * Must stay in sync with `sqlForCanonicalListingIds` ordering.
 */
export function buildSitemapCursorWhereSql(cursor: SitemapJobCursor): Prisma.Sql {
  const p = cursor.postedAt;
  const lf = cursor.listingFreshnessAt;
  const ca = cursor.createdAt;
  const id = cursor.id;

  if (p !== null) {
    return Prisma.sql`(
      (j."postedAt" IS NULL)
      OR (j."postedAt" IS NOT NULL AND j."postedAt" < ${p})
      OR (
        j."postedAt" IS NOT DISTINCT FROM ${p}
        AND (
          j."listingFreshnessAt" < ${lf}
          OR (j."listingFreshnessAt" = ${lf} AND j."createdAt" < ${ca})
          OR (j."listingFreshnessAt" = ${lf} AND j."createdAt" = ${ca} AND j.id > ${id})
        )
      )
    )`;
  }

  return Prisma.sql`(
    j."postedAt" IS NULL
    AND (
      j."listingFreshnessAt" < ${lf}
      OR (j."listingFreshnessAt" = ${lf} AND j."createdAt" < ${ca})
      OR (j."listingFreshnessAt" = ${lf} AND j."createdAt" = ${ca} AND j.id > ${id})
    )
  )`;
}
