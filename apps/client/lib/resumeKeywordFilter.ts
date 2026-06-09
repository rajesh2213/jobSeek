/**
 * Filters job-derived tokens so resume match focuses on scorable skills/terms,
 * not job-posting prose (stop words, HR boilerplate, generic verbs).
 */

/** 2–3 char tokens that are real tech (others this short are dropped). */
const TWO_CHAR_OK = new Set(["go", "c#"]);

const THREE_CHAR_OK = new Set(
  `sql api aws gcp cdn rpc tls ssl vpn dns jwt kpi tfs git etl sso scim saml a11y k8s rds
iam ec2 sqs sns vpc eks ecs gke cli sdk ide ci cd
`
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean),
);

/** 4-char tokens allowed as tech / unambiguous (not generic English). */
const FOUR_CHAR_OK = new Set(
  `java rust ruby sftp yaml json html http ldap saml oidc sspi jdbc jira unix perl ssh vpn
grpc nosql node bash dart helm
`
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean),
);

const STOP = new Set(
  `a an the and or but if in on at to for of as is are was were be been being
it its this that these those we you our your they their them he she his her
i me my we us our you yours will can could should would may might must need
shall with from by into onto than then so not no nor also only just even both
all any each some such very what which who whom whose how when where why
about above after before below between through during under over again further
furthermore however therefore thus hence thus although though yet still
across along around behind below beneath beside between beyond
inside outside within without via per plus minus
`
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean),
);

/** HR / job-posting prose — not “missing skills” if absent from a resume. */
const JOB_FLUFF = new Set(
  `
experienced years year strong excellent great opportunity role working work worked work closely
work
responsible responsibilities responsibility drive passion passionate excited exciting journey
together teammates teammate culture cultural diversity background backgrounds variety join joining
growing grow scale scaling scaled fast faster customer customers enterprise enterprises market markets
journey purpose energy thrive thriving mentoring mentor leadership leading leading-edge best better
growing growing global worldwide region regions countries country locations office offices remote
hybrid onsite site travel traveling flexible flexibility schedule schedules benefits compensation
stakeholders stakeholder executive executives vision mission values value aligned alignment align
someone who you will your our us we re looking for join us today learn more about apply applying
familiarity familiarity with understanding understanding of deep knowledge solid proven track
record ability able skills skill skilled strengths strength effectively effectively communicate
communication verbal written interpersonal collaborative collaboration cross functional multi
disciplinary stakeholder facing manage managing managed management oversee oversees oversight
strategic strategy strategies initiatives initiative roadmap program programs project projects
`
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean),
);

/** More tokens from long JDs — generic nouns/verbs, not scorable gaps. */
const NOISE = new Set(
  `
thousands many several various levels level internal external general overall daily weekly
quarterly annual similar simple complex hands hand hands-on own owned ownership focus focused
focusing help helping helped support supports supporting supported ensure ensuring ensures ensuring that
improve improved improving build built building deliver delivered delivering drive driving drives
create created creating use using used need needed needs make makes making get gets getting
put puts putting take takes taking go goes going do does doing done have has having had
see seen seeing know knew knowing think thought thinking want wanted wanting try tried trying
come came coming use used using run ran running set sets setting keep kept keeping let lets
seem seems seemed look looks looked find finds found give gave given new old big small large
late early next last first second third same other another such few lot lots much many most
very really quite almost already still even ever never always sometimes often usually likely
able unable base based basic basics report reporting reports analytics data datasets dataset
source sources open closed free paid public private social impact digital physical virtual
content context material materials process processes policies policy procedure procedures
balance balances balancing launch launched launching hire hiring hired talent people person
peoples person teams team teamwork teammate teammates journey journeys customer customer-facing
satisfy satisfaction expect expectations expectation meeting meet meets met need needs needed
improvement improvements continuous regular regularly concrete initiatives initiative analyze
analyzed analysis guide guided guiding translate translated translation closely closely-held
achieve achieve achievement kpi kpis goals goal objective objectives metric metrics measure
milestone milestones timeline timelines roadmap roadmaps
products product platform solutions solution offerings offering
recruiting recruitment calendar willing curious diversity
commercial competitive productivity narratives positioning engagement landscape
prospect prospects stakeholders executives partners regional accounts
excel spreadsheets spreadsheet answers automate docs
experience experiences technology technologies software
models model services service solution solutions application applications
infrastructure codebases codebase components foundation fundamentals
particularly seamlessly fundamental establishing contributing
revenue financial billing advanced preferably ideally fluency
proficient skilled excellent comfortable datasets recognition
discussions issues including built complete provide feel handle
command degree computer systems line developers developer customers
testing administration operating databases
engineering engineer engineers
science
learning
`
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean),
);

/** Phrases that stay scorable when parts are weak in isolation (e.g. “machine” + “learning”). */
const COMPOUND_OK = new Set(
  `machine learning
deep learning
data science
data engineering
computer science
sign on
single sign on
single sign-on
end to end
production ready
`
    .toLowerCase()
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean),
);

const BRAND = new Set(
  `openai toyota ramp notion figma asana atlassian jira confluence monday slacks slack
shopify salesforce sfdc intercom hubspot datadog newrelic splunk mulesoft snowflake databricks
netsuite workday
`.toLowerCase().split(/\s+/).filter(Boolean),
);

/** Title/role phrasing — not a stack “gap” token pair. */
const BANNED_ROLE_PHRASES = new Set(
  [
    "software engineer",
    "product manager",
    "data scientist",
    "project manager",
    "full stack",
    "full-stack",
    "fullstack",
    "backend developer",
    "frontend developer",
    "full stack engineer",
    "web developer",
    "site reliability",
    "staff engineer",
    "senior engineer",
    "principal engineer",
    "solutions engineer",
    "customer success",
    "account executive",
    "business development",
  ].map((s) => s.toLowerCase()),
);

/**
 * 2-word phrases: reject JD boilerplate (noise/stop) and role title pairs.
 * Does not run for {@link COMPOUND_OK} (handled in {@link isScorableResumeKeyword} first).
 */
export function isAcceptableResumeBigram(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const pair = `${x} ${y}`;
  if (BANNED_ROLE_PHRASES.has(pair)) return false;
  if (STOP.has(x) || STOP.has(y)) return false;
  if (NOISE.has(x) || NOISE.has(y)) return false;
  if (JOB_FLUFF.has(x) || JOB_FLUFF.has(y)) return false;
  if (BRAND.has(x) || BRAND.has(y)) return false;
  return true;
}

/** Shared dictionary aliases → canonical; keep filters aligned with resume scoring. */
export { normalizeKeywordForMatch } from "@jobseek/skill-constants";

/** Tighter cap: fewer, higher-signal terms for gap lists. */
export const MAX_RESUME_MATCH_KEYWORDS = 32;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Heuristic: is this a token or phrase we should track for resume ↔ job match?
 * Single 4-letter words must be clearly tech/role-like or they are dropped.
 */
export function isScorableResumeKeyword(keyword: string): boolean {
  const raw = keyword.toLowerCase().trim();
  if (raw.length < 2 || raw.length > 72) return false;
  if (raw.length === 2) return TWO_CHAR_OK.has(raw);
  if (raw.includes("  ")) return false;

  if (raw.includes(" ")) {
    if (COMPOUND_OK.has(raw)) return true;
    const parts = raw.split(/\s+/).filter((p) => p.length);
    if (parts.length > 2) return false;
    if (parts.length === 2) {
      if (!isAcceptableResumeBigram(parts[0]!, parts[1]!)) return false;
    } else if (parts.length < 2) {
      return isScorableResumeKeyword(parts[0] ?? "");
    }
    // Drop phrases made only of stop/fluff
    const meaningful = parts.filter(
      (p) => p.length > 0 && !STOP.has(p) && !JOB_FLUFF.has(p) && !NOISE.has(p),
    );
    if (meaningful.length === 0) return false;
    if (parts.every((p) => p.length <= 3 && !THREE_CHAR_OK.has(p) && !FOUR_CHAR_OK.has(p)))
      return false;
    // At least one “strong” part (longer token or allowlisted)
    return meaningful.some(
      (p) =>
        p.length >= 4 ||
        THREE_CHAR_OK.has(p) ||
        FOUR_CHAR_OK.has(p) ||
        /^[0-9]/.test(p),
    );
  }

  if (raw.includes("-")) {
    const segs = raw.split("-").map((s) => s.toLowerCase());
    if (segs.length < 2) return isScorableResumeKeyword(segs[0] ?? "");
    return segs.some(
      (s) =>
        s.length >= 4 &&
        !STOP.has(s) &&
        !JOB_FLUFF.has(s) &&
        !NOISE.has(s) &&
        !BRAND.has(s),
    );
  }

  if (STOP.has(raw) || JOB_FLUFF.has(raw) || NOISE.has(raw) || BRAND.has(raw)) return false;

  if (raw.length === 3) {
    if (raw === "c++") return true;
    return THREE_CHAR_OK.has(raw);
  }
  if (raw.length === 4) return FOUR_CHAR_OK.has(raw) || /[0-9#.+]/.test(raw);
  return true;
}

/** Short tech/abbrev: allow substring (e.g. “sql” inside “MySQL”) */
const TIGHT_OK_SUBSTRING = new Set(
  `sql api aws gcp cdn sso saml oidc scim etl sre rpc tls idp ldap sftp jdbc grpc nosql
postgres postgresql nodejs nextjs typescript golang
`.toLowerCase()
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * True if `keyword` appears in the resume in a way that should count as a “match”
 * (word boundaries; tech abbreviations get looser rules).
 */
export function resumeTextMatchesKeyword(resumeText: string, keyword: string): boolean {
  const lower = resumeText.toLowerCase();
  const kw = keyword.toLowerCase().trim();
  if (!kw) return false;

  if (kw.includes(" ")) {
    const pattern = kw.split(/\s+/).map(escapeRegExp).join("\\s+");
    return new RegExp(pattern, "i").test(resumeText);
  }

  if (kw.includes("-")) {
    if (TIGHT_OK_SUBSTRING.has(kw)) {
      return lower.includes(kw);
    }
    return new RegExp(
      `(^|[^\\w-])${escapeRegExp(kw)}([^\\w-]|$)`,
      "i",
    ).test(resumeText);
  }

  if (TIGHT_OK_SUBSTRING.has(kw) || (kw.length <= 4 && (THREE_CHAR_OK.has(kw) || FOUR_CHAR_OK.has(kw)))) {
    return lower.includes(kw);
  }

  return new RegExp(`\\b${escapeRegExp(kw)}\\b`, "i").test(resumeText);
}

export function takeTopScorableKeywords(
  list: { keyword: string; category: "required" | "preferred"; priority: 1 | 2 | 3 }[],
  max: number = MAX_RESUME_MATCH_KEYWORDS,
): { keyword: string; category: "required" | "preferred"; priority: 1 | 2 | 3 }[] {
  const arr = list.filter((k) => isScorableResumeKeyword(k.keyword));
  arr.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.keyword.length !== b.keyword.length) return b.keyword.length - a.keyword.length;
    return a.keyword.localeCompare(b.keyword);
  });
  return arr.slice(0, max);
}
