/** Deterministic repair-worker cursor: (createdAt ISO, job id). */
export type WorkdayRepairCursor = {
  createdAt: string;
  id: string;
};

const SEP = "\u001f";

export function encodeWorkdayRepairCursor(cursor: WorkdayRepairCursor): string {
  return `${cursor.createdAt}${SEP}${cursor.id}`;
}

export function decodeWorkdayRepairCursor(raw: string | undefined): WorkdayRepairCursor | null {
  if (!raw?.trim()) return null;
  const idx = raw.indexOf(SEP);
  if (idx <= 0) return null;
  const createdAt = raw.slice(0, idx);
  const id = raw.slice(idx + SEP.length);
  if (!createdAt || !id) return null;
  const parsed = Date.parse(createdAt);
  if (Number.isNaN(parsed)) return null;
  return { createdAt, id };
}

/** Prisma where-clause fragment for keyset pagination after cursor. */
export function workdayCursorWhere(cursor: WorkdayRepairCursor | null): {
  OR?: Array<Record<string, unknown>>;
} {
  if (!cursor) return {};
  const at = new Date(cursor.createdAt);
  return {
    OR: [
      { createdAt: { gt: at } },
      { AND: [{ createdAt: at }, { id: { gt: cursor.id } }] },
    ],
  };
}
