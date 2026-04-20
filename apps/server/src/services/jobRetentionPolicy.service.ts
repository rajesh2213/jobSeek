const ATS_TTL_DAYS = 21;
const OTHER_TTL_DAYS = 45;

const ATS_SOURCES = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "jobvite",
  "workable",
  "smartrecruiters",
  "bamboohr",
  "teamtailor",
  "rippling",
  "workday",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

export function ttlDaysForSource(source: string): number {
  const normalized = source.trim().toLowerCase();
  return ATS_SOURCES.has(normalized) ? ATS_TTL_DAYS : OTHER_TTL_DAYS;
}

export function computeJobExpiresAt(input: {
  source: string;
  lastSeenAt: Date;
}): Date {
  const ttlDays = ttlDaysForSource(input.source);
  return new Date(input.lastSeenAt.getTime() + ttlDays * DAY_MS);
}
