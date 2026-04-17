/**
 * ATS pages include (a) native ATS hostnames and (b) employer career sites that embed
 * Greenhouse, Workday, etc. The latter use the company domain, so we also match URL signals.
 */
export const ATS_HOST_SUBSTRINGS = [
  "greenhouse.io",
  "myworkdayjobs.com",
  "workday.com",
  "lever.co",
  "ashbyhq.com",
  "bamboohr.com",
  "smartrecruiters.com",
  "jobvite.com",
  "workable.com",
  "teamtailor.com",
  "rippling.com",
];

/**
 * Returns true when the tab URL looks like a job application flow on a known ATS or embed.
 */
export function isLikelyAtsPage(href: string): boolean {
  let host = "";
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (ATS_HOST_SUBSTRINGS.some((s) => host.includes(s))) {
    return true;
  }

  const h = href.toLowerCase();

  // Greenhouse on employer domains: ?gh_jid=… / ?gh_src=… (boards API / embed)
  if (/\bgh_jid=/.test(h) || /\bgh_src=/.test(h) || /\bgh_ll=/.test(h)) {
    return true;
  }

  // Greenhouse embed hash e.g. #grnhse_app on asana.com/jobs/apply/…
  if (/[#?&]grnhse|grnhse_app/i.test(h)) {
    return true;
  }

  return false;
}
