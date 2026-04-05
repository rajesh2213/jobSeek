const DEBUG_QUERIES = [
  "site:boards.greenhouse.io",
  "site:jobs.lever.co",
  "site:jobs.ashbyhq.com",
] as const;

export function isSerpDebugMode(): boolean {
  return process.env.SERP_MODE?.trim().toLowerCase() === "debug";
}

export function serpQueryGenerator(): string[] {
  if (isSerpDebugMode()) {
    return [...DEBUG_QUERIES];
  }

  // Deterministic high-signal queries; order matters.
  const queries = [
    'site:boards.greenhouse.io "jobs"',
    'site:boards.greenhouse.io "careers"',

    "site:jobs.lever.co",
    'site:lever.co "careers"',

    "site:jobs.ashbyhq.com",
    'site:ashbyhq.com "jobs"',

    "site:jobs.workable.com",
    'site:jobs.workable.com "careers"',

    'site:*.myworkdayjobs.com "jobs"',
    'site:*.myworkdayjobs.com "careers"',

    "site:smartrecruiters.com careers",
    "site:bamboohr.com/careers",
    "site:teamtailor.com/jobs",
    "site:rippling.com/careers",

    "site:jobs.jobvite.com",
    "site:icims.com/jobs",
  ];

  return queries;
}

