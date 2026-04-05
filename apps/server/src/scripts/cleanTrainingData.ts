/**
 * Clean, normalize, and relabel training-data.json for job line classification.
 *
 * Run: npx tsx src/scripts/cleanTrainingData.ts
 *      npx tsx src/scripts/cleanTrainingData.ts --dry-run
 *      npx tsx src/scripts/cleanTrainingData.ts --review  (quarantine file only + 20-row preview; skips balancing)
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import he from "he";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.join(__dirname, "training-data.json");
const QUARANTINE_PATH = path.join(__dirname, "training-data-quarantine.json");

const VALID_LABELS = new Set([
  "responsibility",
  "requirement",
  "experience",
  "benefit",
  "contact",
  "position",
  "other",
]);

interface TrainingSample {
  text: string;
  label: string;
  confidence?: "high" | "low";
}

type LineLabel = TrainingSample["label"];

/** Stable iteration order for grouping, promotion, and reports. */
const LABEL_ORDER = [
  "responsibility",
  "requirement",
  "experience",
  "benefit",
  "contact",
  "position",
  "other",
] as const;

const MIN_PROMOTE_PER_LABEL = 150;
/** Pull extra `other` lines into the pool so totals can reach TARGET_MIN_TOTAL when benefit is scarce. */
const MIN_PROMOTE_OTHER = 620;
const MIN_PROMOTE_BENEFIT_EXP = 300;
const MAX_RESP_REQ = 2500;
const RATIO_CAP_MULTIPLIER = 4;
/** Labels whose size anchors the 4× cap (excludes rare job-posting lines). */
const RATIO_ANCHOR_LABELS = [
  "responsibility",
  "requirement",
  "benefit",
  "other",
] as const;
/** Rare labels: never anchor the ratio; keep up to this many rows each. */
const RARE_LABEL_MAX_POOL = 500;
const TARGET_MIN_TOTAL = 8000;
const TARGET_MAX_TOTAL = 12000;
/**
 * Minimum ratio denominator so commons can approach TARGET_MIN_TOTAL once rare rows
 * (experience + contact + position, typically under 1k combined) are set aside.
 */
const RATIO_DENOMINATOR_FLOOR = Math.max(
  300,
  Math.ceil(
    (TARGET_MIN_TOTAL - 750) / (RATIO_CAP_MULTIPLIER * RATIO_ANCHOR_LABELS.length),
  ),
  /** Lets resp/req reach MAX_RESP_REQ when anchor pools are large enough. */
  Math.ceil(MAX_RESP_REQ / RATIO_CAP_MULTIPLIER),
);

/** Minimum counts expected after balancing (warn if raw data cannot meet). */
const MIN_AFTER_BALANCE: Partial<Record<LineLabel, number>> = {
  benefit: 300,
  experience: 300,
  other: 300,
  contact: 150,
  position: 150,
};

/**
 * Hardcoded substring corrections: keys are lowercase; if normalized text includes
 * a key, that label is forced (first Map entry wins). Applied before ensemble.
 * Longer keys are listed first so a shorter key cannot steal a match.
 */
const MANUAL_OVERRIDES = new Map<string, LineLabel>([
  ["experience organizing executive travel (domestic and international)", "requirement"],
  ["programming (proficient in at least two languages", "requirement"],
  ["you should also have a demonstrated ability to think", "requirement"],
  ["ability to interact with and build productive working relationships", "requirement"],
  ["ability to mentor and develop team into high performing", "requirement"],
  ["strong english communication skills, particularly the ability to engage", "requirement"],
  ["strong background in software engineering and system design", "requirement"],
  ["ability to foster a team-orientated environment within the sales", "requirement"],
  ["ability to handle multiple tasks, prioritize tasks and meet delivery", "requirement"],
  ["ability to thrive in a fast-paced environment and provide support", "requirement"],
  ["strong research skills, including use of am best", "requirement"],
  ["individuals should display strong achievement orientation, intellectual curiosity", "requirement"],

  ["assist with financial reporting, quarterly updates", "responsibility"],
  ["what you will do as a software engineer", "responsibility"],
  ["build dashboards using tableau and excel", "responsibility"],
  ["implement basic devops pipelines", "responsibility"],
  ["create basic diagrams and visuals", "responsibility"],
  ["automate tests using selenium", "responsibility"],

  ["vets indexes award for employers who support", "other"],
  ["no job detail available. partager cette offre", "other"],
]);

const UI_JUNK_LINE = [
  /^share this job\b/i,
  /^see all jobs\b/i,
  /^save (this )?job\b/i,
  /^apply now\.?$/i,
  /^click here\b/i,
  /^similar jobs\b/i,
  /^search jobs\b/i,
  /^cookie/i,
  /^navigation\b/i,
  /full linkedin profile will be shared/i,
  /^apply with linkedin/i,
  /^once you find a role\b/i,
  /^sign in\b/i,
  /^create an? account\b/i,
  /\bsubscribe to (our )?newsletter\b/i,
  /\b\d+\s+(?:hours?|days?|weeks?)\s+ago\b/i,
  /\bsaved\b.*\b(?:in-office|on-site|remote)\b/i,
  /\bclick to save\b/i,
];

const PREFIXES = [
  /^what you(?:'|')ll (?:do|need):\s*/i,
  /^what you will (?:do|need):\s*/i,
  /^requirements?:\s*/i,
  /^responsibilities?:\s*/i,
  /^bonus points?:\s*/i,
  /^key responsibilities:\s*/i,
  /^qualifications?:\s*/i,
  /^about the role:\s*/i,
  /^the role:\s*/i,
  /^job description:\s*/i,
  /^your impact:\s*/i,
];

/** Strip legacy augment suffixes. */
const VARIANT_SUFFIX = /\s*\(variant\s+\d+\)\s*$/i;

const EMAIL_RE = /\b[\w.%+-]+@[A-Za-z0-9][\w.-]*\.[A-Za-z]{2,}\b/;
const URL_RE = /https?:\/\/[^\s]+|www\.[^\s]+/i;

const EXP_YEARS_PLUS_RE = /\b(\d{1,2})\s*\+\s*years?\b/i;
const EXP_YEARS_RANGE_RE = /\b(\d{1,2})\s*[\u2013-]\s*(\d{1,2})\s*years?\b/i;
const EXP_YEARS_OF_RE = /\b(\d{1,2})\s+years?\s+of\s+experience\b/i;
const EXP_DIGIT_YEARS_RE = /\b(\d{1,2})\s+years?\b(?!\s+of\s hands-on)/i;

const BENEFIT_RE =
  /\b(salary|compensation|base pay|\$\d|cad\b|usd\b|eur\b|insurance|health\s+care|dental|vision|401\s*\(?k\)?|pto|paid\s+time|parental\s+leave|equity|stock\s+options?|bonus\b|perks?\s|benefits?\s+package|stipend|unlimited\s+pto|vacation|time\s+off)\b/i;

const POSITION_ROLE_WORD =
  /\b(?:Engineer|Developer|Manager|Director|Scientist|Analyst|Architect|Specialist|Designer|Consultant|Officer|Coordinator|Executive|Representative|Recruiter|Technician|Researcher|Programmer|Administrator|Assistant|President|Writer|Editor|Lead(?:er)?|Intern)\b/i;

const POSITION_LINE_RE =
  /^(?:(?:Senior|Staff|Principal|Junior|Mid|Lead|Associate|Sr\.|Jr\.)\s+)?[A-Za-z0-9][A-Za-z0-9\s,.+&/'()-]{5,85}$/;

/** Duty / imperative verbs (shared by RESP_VERB_RE and line-start imperative check). */
const RESP_VERB_ALTS =
  "build|building|develop|design|implement|manage|optimize|lead|deliver|collaborate|drive|support|create|improve|plan|coordinate|execute|maintain|monitor|review|analyze|architect|deploy|integrate|establish|ensure|oversee|write|define|ship|troubleshoot|mentor|facilitate|iterate|own|handle|conduct|perform|prepare|validate|test|automate|scale|streamline|grow|expand|produce|draft|outline|advise|demonstrate|track|utilize|present|negotiate|influence|champion|evangelize|prioritize|synthesize|research|document|report|investigate|identify|pivot";

const RESP_VERB_RE = new RegExp(`\\b(?:${RESP_VERB_ALTS})\\b`, "i");

const IMPERATIVE_START_RE = new RegExp(`^(?:${RESP_VERB_ALTS})\\b`, "i");

const REQ_SKILL_RE =
  /\b(python|java|go\b|rust|ruby|php|swift|kotlin|scala|perl|c\+\+|sql|aws|gcp|azure|kubernetes|docker|react|angular|vue|node\.?js|typescript|javascript|graphql|redis|mongodb|postgres|elasticsearch|terraform|linux|kubernetes|kafka|spark|hadoop|snowflake|databricks|figma|jira|salesforce|power\s*bi|tableau|excel|sap\b|oracle|\.net|dotnet|machine learning|ml\b|nlp\b|ai\b|blockchain)\b/i;

const REQ_QUAL_RE =
  /\b(proficiency|familiarity|knowledge\s+of|experience\s+with|degree|bachelor|master|phd|certification|certified|strong\s+understanding|hand-?on|must\s+have|required\s+to|ability\s+to\s+(?:work|communicate)|fundamentals?|basics?|understanding\s+of)\b/i;

/** Colon-separated skill / requirement list (e.g. "Skills: Python, Java"). */
const COLON_SKILL_LIST_RE =
  /^(?:skills?|technologies|tech stack|requirements?|qualifications?|must\s+haves?|nice\s+to\s+haves?)\s*:\s*.+[,:;].+/i;

/** Qualification phrasing: "Experience building…", "Demonstrated ability…", etc. */
const EXP_QUAL_LINE_RE =
  /^[-*•\s]*experience\s+(?:in|with|on|of|building|working|supporting|managing|developing|leading|using)\b/i;

const ABILITY_PROVEN_LINE_RE =
  /^[-*•\s]*(?:demonstrated|proven)\s+ability\b/i;

/** Tenure-as-role ("experience as a …") is not a job title line. */
const EXPERIENCE_AS_ROLE_RE = /^experience\s+as\s+a\b/i;

function matchesExperienceQualificationLine(t: string): boolean {
  return EXP_QUAL_LINE_RE.test(t) || ABILITY_PROVEN_LINE_RE.test(t);
}

/** Keyword-path requirement: qual patterns, REQ_QUAL, or skill-only (not long duty + tech). */
function matchesKeywordRequirement(t: string, lower: string): boolean {
  if (matchesExperienceQualificationLine(t)) return true;
  if (REQ_QUAL_RE.test(lower)) return true;
  const skillHit = REQ_SKILL_RE.test(t);
  const verbHit = RESP_VERB_RE.test(t);
  if (skillHit && !(verbHit && t.length > 45)) return true;
  return false;
}

function normalizeText(raw: string): string {
  let t = he.decode(raw);
  t = t.replace(VARIANT_SUFFIX, "");
  t = t.replace(/\u00a0/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  for (let p = 0; p < 8; p++) {
    const before = t;
    for (const pr of PREFIXES) {
      t = t.replace(pr, "").trim();
    }
    if (t === before) break;
  }
  t = t.replace(/\byears\s+years\b/gi, "years");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function isJunkLine(t: string): boolean {
  if (!t || t.length < 12) return true;
  if (/\bapply now\b/i.test(t) && !EMAIL_RE.test(t) && !URL_RE.test(t)) return true;
  for (const re of UI_JUNK_LINE) {
    if (re.test(t)) return true;
  }
  if (/^[\d\s+,.$£€-]+$/.test(t) && t.length < 25) return true;
  return false;
}

function clampLength(t: string, max = 320): string {
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const cut = slice.lastIndexOf(" ");
  return (cut > 60 ? slice.slice(0, cut) : slice).trim();
}

function standardizeExperienceText(t: string): string | null {
  let m = t.match(EXP_YEARS_OF_RE);
  if (m) return `${m[1]} years experience`;
  m = t.match(EXP_YEARS_PLUS_RE);
  if (m) return `${m[1]}+ years experience`;
  m = t.match(EXP_YEARS_RANGE_RE);
  if (m) return `${m[1]} to ${m[2]} years experience`;
  m = t.match(/^(\d{1,2})\s+years?\b/i);
  if (m && /\bexperience\b/i.test(t)) return `${m[1]} years experience`;
  if (EXP_DIGIT_YEARS_RE.test(t) && /\bexperience\b/i.test(t)) {
    const m2 = t.match(/\b(\d{1,2})\s+years?\b/i);
    if (m2) return `${m2[1]} years experience`;
  }
  return null;
}

/** True if line has a sentence-ending period (not only Sr./Jr./Dr./etc.). */
function hasMidSentencePeriod(t: string): boolean {
  const stripped = t.replace(/\b(?:Sr|Jr|Dr|Mr|Mrs|Ms|Inc|Ltd|Corp)\./gi, "");
  return /\./.test(stripped);
}

function matchesExperienceLine(t: string): boolean {
  if (standardizeExperienceText(t)) return true;
  if (/\b\d{1,2}\s*\+\s*years?\b/i.test(t) || /\byears?\s+of\s+experience\b/i.test(t)) return true;
  return false;
}

/** Independent rule hits for override / confidence (parallel, not priority). */
function collectKeywordParallelMatches(t: string, lower: string): Set<string> {
  const hits = new Set<string>();
  if (EMAIL_RE.test(t) || URL_RE.test(t) || /\bmailto:/i.test(t)) hits.add("contact");
  if (matchesExperienceLine(t)) hits.add("experience");
  if (!/^bonus points?:/i.test(t) && BENEFIT_RE.test(t)) hits.add("benefit");
  if (matchesKeywordRequirement(t, lower)) hits.add("requirement");
  if (
    RESP_VERB_RE.test(t) &&
    t.length > 30 &&
    !REQ_QUAL_RE.test(lower)
  ) {
    hits.add("responsibility");
  }
  if (
    !EXPERIENCE_AS_ROLE_RE.test(lower) &&
    POSITION_LINE_RE.test(t) &&
    POSITION_ROLE_WORD.test(t) &&
    !RESP_VERB_RE.test(t) &&
    !hasMidSentencePeriod(t) &&
    t.length < 80
  ) {
    hits.add("position");
  }
  return hits;
}

/**
 * Regex keyword classifier: contact → experience → benefit → requirement →
 * responsibility → position → other. If both RESP_VERB_RE and POSITION_LINE_RE
 * match, responsibility wins (requirement block above handles skill claims).
 */
function inferByKeyword(text: string): string {
  const t = text;
  const lower = t.toLowerCase();

  if (EMAIL_RE.test(t) || URL_RE.test(t) || /\bmailto:/i.test(t)) {
    return "contact";
  }
  const expStd = standardizeExperienceText(t);
  if (expStd) {
    return "experience";
  }

  if (!/^bonus points?:/i.test(t) && BENEFIT_RE.test(t)) {
    return "benefit";
  }

  if (matchesExperienceQualificationLine(t)) {
    return "requirement";
  }

  if (REQ_QUAL_RE.test(lower)) {
    return "requirement";
  }

  const skillHit = REQ_SKILL_RE.test(t);
  const verbHit = RESP_VERB_RE.test(t);
  if (skillHit && !(verbHit && t.length > 45)) {
    return "requirement";
  }

  if (verbHit && t.length > 30 && !REQ_QUAL_RE.test(lower)) {
    return "responsibility";
  }

  if (
    !EXPERIENCE_AS_ROLE_RE.test(lower) &&
    POSITION_LINE_RE.test(t) &&
    POSITION_ROLE_WORD.test(t) &&
    !RESP_VERB_RE.test(t) &&
    !hasMidSentencePeriod(t) &&
    !/[.!?]{2,}/.test(t) &&
    t.length < 80
  ) {
    return "position";
  }

  if (/\b\d{1,2}\s*\+\s*years?\b/i.test(t) || /\byears?\s+of\s+experience\b/i.test(t)) {
    return "experience";
  }

  return "other";
}

/** Years-style noun phrase at line start → experience. */
const EXP_START_RE =
  /^\d{1,2}\s*[\u2013+-]?\s*\d{0,2}\s*years?\b/i;

/** Title-like: starts with capital letter, has role word, short, no responsibility verb. */
function inferByStructure(text: string): string {
  const t = text.trim();
  const lower = t.toLowerCase();

  if (EMAIL_RE.test(t) || URL_RE.test(t) || /\bmailto:/i.test(t)) {
    return "contact";
  }
  if (!/^bonus points?:/i.test(t) && BENEFIT_RE.test(t)) {
    return "benefit";
  }
  if (matchesExperienceQualificationLine(t)) {
    return "requirement";
  }
  if (matchesExperienceLine(t) || EXP_START_RE.test(t) || /^at least\s+\d{1,2}\s+years?\b/i.test(t)) {
    return "experience";
  }
  if (IMPERATIVE_START_RE.test(t)) {
    return "responsibility";
  }
  if (
    !EXPERIENCE_AS_ROLE_RE.test(lower) &&
    /^[A-Z]/.test(t) &&
    POSITION_ROLE_WORD.test(t) &&
    !RESP_VERB_RE.test(t) &&
    t.length < 80 &&
    !hasMidSentencePeriod(t)
  ) {
    return "position";
  }
  if (matchesKeywordRequirement(t, lower)) {
    return "requirement";
  }
  return "other";
}

/**
 * Context-only signals. Returns null when no contextual rule applies (abstain)
 * so long lines are not forced to "other" vs keyword/structure.
 */
function inferByContext(text: string): string | null {
  const t = text.trim();
  if (EMAIL_RE.test(t) || URL_RE.test(t)) {
    return "contact";
  }
  if (t.length < 25) {
    return "other";
  }
  if (COLON_SKILL_LIST_RE.test(t)) {
    return "requirement";
  }
  return null;
}

function majorityLabelThree(a: string, b: string, c: string): string {
  if (a === b || a === c) return a;
  if (b === c) return b;
  return "other";
}

type InferLabelResult = {
  label: string;
  confidence: "high" | "low";
  votes: [string, string, string];
  keywordParallelHits: Set<string>;
  fellThroughOtherNoStrongKeyword: boolean;
};

function manualOverrideLabel(lower: string): LineLabel | null {
  for (const [needle, lab] of MANUAL_OVERRIDES) {
    if (needle.length > 0 && lower.includes(needle)) return lab;
  }
  return null;
}

/**
 * Ensemble: inferByKeyword, inferByStructure, inferByContext → majority vote;
 * if context abstains, keyword vs structure must agree or keyword wins.
 * If all three active votes differ → other. Confidence: high only on unanimous
 * agreement among participating voters, no parallel keyword override, and no weak other.
 */
function inferLabel(text: string): InferLabelResult {
  const lower = text.toLowerCase();
  const forced = manualOverrideLabel(lower);
  if (forced) {
    return {
      label: forced,
      confidence: "high",
      votes: [forced, forced, forced],
      keywordParallelHits: new Set([forced]),
      fellThroughOtherNoStrongKeyword: false,
    };
  }

  const kw = inferByKeyword(text);
  const st = inferByStructure(text);
  const ctx = inferByContext(text);

  let label: string;
  let unanimous: boolean;

  if (ctx !== null) {
    label = majorityLabelThree(kw, st, ctx);
    unanimous = kw === st && st === ctx;
  } else {
    label = kw === st ? kw : kw;
    unanimous = kw === st;
  }

  const votes: [string, string, string] = [kw, st, ctx ?? "abstain"];

  const parallel = collectKeywordParallelMatches(text, lower);
  const keywordMultiMatchOverridden = parallel.size > 1;

  const keywordStrongChain =
    kw !== "other" ||
    (EMAIL_RE.test(text) ||
      URL_RE.test(text) ||
      /\bmailto:/i.test(text) ||
      !!standardizeExperienceText(text) ||
      (!/^bonus points?:/i.test(text) && BENEFIT_RE.test(text)) ||
      matchesKeywordRequirement(text, lower) ||
      (RESP_VERB_RE.test(text) && text.length > 30 && !REQ_QUAL_RE.test(lower)) ||
      (POSITION_LINE_RE.test(text) &&
        POSITION_ROLE_WORD.test(text) &&
        !RESP_VERB_RE.test(text) &&
        !hasMidSentencePeriod(text) &&
        text.length < 80 &&
        !EXPERIENCE_AS_ROLE_RE.test(lower)) ||
      /\b\d{1,2}\s*\+\s*years?\b/i.test(text) ||
      /\byears?\s+of\s+experience\b/i.test(text));

  const fellThroughOtherNoStrongKeyword = label === "other" && !keywordStrongChain;

  let confidence: "high" | "low" = "high";
  if (!unanimous) confidence = "low";
  if (keywordMultiMatchOverridden) confidence = "low";
  if (fellThroughOtherNoStrongKeyword) confidence = "low";

  return {
    label,
    confidence,
    votes,
    keywordParallelHits: parallel,
    fellThroughOtherNoStrongKeyword,
  };
}

function finalTextForLabel(text: string, label: string): string | null {
  let t = text;
  const exp = standardizeExperienceText(t);
  if (label === "experience" && exp) t = exp;

  t = clampLength(t);
  if (isJunkLine(t)) return null;

  if (label === "contact") {
    if (!EMAIL_RE.test(t) && !URL_RE.test(t) && !/mailto:/i.test(t)) return null;
  }

  return t;
}

function dedupeKey(text: string, label: string): string {
  return `${label}\t${text.toLowerCase()}`;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

/** Remove up to `needed` rows matching `label` from quarantine (end-first); promote as high-confidence. */
function promoteFromQuarantine(
  label: string,
  needed: number,
  quarantine: TrainingSample[],
): TrainingSample[] {
  if (needed <= 0) return [];
  const promoted: TrainingSample[] = [];
  for (let i = quarantine.length - 1; i >= 0 && promoted.length < needed; i--) {
    const row = quarantine[i]!;
    if (row.label === label) {
      promoted.push({ ...row, confidence: "high" });
      quarantine.splice(i, 1);
    }
  }
  return promoted;
}

function countByLabel(samples: TrainingSample[], label: string): number {
  let n = 0;
  for (const s of samples) {
    if (s.label === label) n += 1;
  }
  return n;
}

const SYNTHETIC_EXP_TARGET = 400;

const SYNTHETIC_EXP_DOMAINS = [
  "software engineering",
  "data science",
  "product management",
  "cloud infrastructure",
  "machine learning",
  "cybersecurity",
  "financial services",
  "healthcare technology",
  "enterprise SaaS",
  "DevOps and site reliability",
  "mobile application development",
  "embedded systems",
  "systems administration",
  "quality assurance",
  "technical writing",
  "developer relations",
  "solutions architecture",
  "IT operations",
  "business intelligence",
  "digital marketing technology",
];

/** Display names aligned with REQ_SKILL_RE tokens for "working with …" lines. */
const SYNTHETIC_EXP_TECH = [
  "Python",
  "Java",
  "Go",
  "Rust",
  "Ruby",
  "PHP",
  "Swift",
  "Kotlin",
  "Scala",
  "Perl",
  "C++",
  "SQL",
  "AWS",
  "GCP",
  "Azure",
  "Kubernetes",
  "Docker",
  "React",
  "Angular",
  "Vue",
  "Node.js",
  "TypeScript",
  "JavaScript",
  "GraphQL",
  "Redis",
  "MongoDB",
  "Postgres",
  "Elasticsearch",
  "Terraform",
  "Linux",
  "Kafka",
  "Spark",
  "Snowflake",
  "Databricks",
  "Figma",
  "Jira",
  "Salesforce",
  "Power BI",
  "Tableau",
  "Excel",
  "SAP",
  "Oracle",
  ".NET",
  "machine learning",
  "NLP",
  "AI",
  "blockchain",
];

const SYNTHETIC_EXP_ROLE_ADJECTIVES = [
  "senior",
  "technical",
  "client-facing",
  "leadership",
  "hands-on",
];

const SYNTHETIC_EXP_YEAR_RANGES: readonly [number, number][] = [
  [2, 4],
  [3, 5],
  [5, 8],
  [7, 10],
  [1, 3],
  [4, 6],
  [6, 9],
  [8, 12],
];

/**
 * Synthetic experience-class lines so the model sees enough tenure patterns.
 * Deduped by lowercase text; caps at SYNTHETIC_EXP_TARGET unique rows.
 */
function generateExperienceSamples(): TrainingSample[] {
  const seen = new Set<string>();
  const out: TrainingSample[] = [];
  const add = (text: string) => {
    if (out.length >= SYNTHETIC_EXP_TARGET) return;
    const k = text.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ text, label: "experience", confidence: "high" });
  };

  for (let x = 1; x <= 15; x++) {
    for (const domain of SYNTHETIC_EXP_DOMAINS) {
      add(`${x}+ years of experience in ${domain}`);
    }
  }

  for (const [a, b] of SYNTHETIC_EXP_YEAR_RANGES) {
    add(`${a} to ${b} years of experience`);
  }

  for (let x = 1; x <= 15; x++) {
    add(`Minimum ${x} years of relevant experience`);
  }

  for (let x = 1; x <= 12; x++) {
    for (const tech of SYNTHETIC_EXP_TECH) {
      add(`At least ${x} years working with ${tech}`);
    }
  }

  for (let x = 1; x <= 15; x++) {
    for (const adj of SYNTHETIC_EXP_ROLE_ADJECTIVES) {
      add(`${x} years in a ${adj} role`);
    }
  }

  return out;
}

/** Shrink pools until total ≤ maxTotal without going below per-label floors (resp/req floor 0). */
function trimTotalToCap(
  byLabel: Map<string, TrainingSample[]>,
  maxTotal: number,
  minFloor: Record<string, number>,
): void {
  let total = 0;
  for (const arr of byLabel.values()) total += arr.length;
  while (total > maxTotal) {
    let best: string | null = null;
    let bestLen = -1;
    for (const [label, arr] of byLabel) {
      const floor = minFloor[label] ?? 0;
      if (arr.length > floor && arr.length > bestLen) {
        bestLen = arr.length;
        best = label;
      }
    }
    if (!best) break;
    const arr = byLabel.get(best)!;
    const idx = Math.floor(Math.random() * arr.length);
    arr.splice(idx, 1);
    total -= 1;
  }
}

const MIN_FLOOR_TRIM: Record<string, number> = {
  benefit: MIN_AFTER_BALANCE.benefit!,
  experience: MIN_AFTER_BALANCE.experience!,
  other: MIN_AFTER_BALANCE.other!,
  contact: MIN_AFTER_BALANCE.contact!,
  position: MIN_AFTER_BALANCE.position!,
};

/**
 * Cap commons (responsibility, requirement, benefit, other) at 4× the smallest among those four
 * (plus denominator floor). Rare labels (experience, contact, position) do not anchor the cap;
 * they keep all rows up to RARE_LABEL_MAX_POOL. Resp/req also capped at MAX_RESP_REQ.
 */
function balanceDataset(samples: TrainingSample[]): {
  balanced: TrainingSample[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const byLabel = new Map<string, TrainingSample[]>();
  for (const l of LABEL_ORDER) byLabel.set(l, []);
  for (const s of samples) {
    if (!VALID_LABELS.has(s.label)) continue;
    if (!byLabel.has(s.label)) byLabel.set(s.label, []);
    byLabel.get(s.label)!.push(s);
  }
  for (const arr of byLabel.values()) shuffleInPlace(arr);

  const commonCounts = RATIO_ANCHOR_LABELS.map((l) => byLabel.get(l)!.length).filter(
    (n) => n > 0,
  );
  if (commonCounts.length === 0 && samples.length > 0) {
    warnings.push("No ratio-anchor labels present; only rare classes in pool.");
  }
  const anyRows = [...byLabel.values()].some((a) => a.length > 0);
  if (!anyRows) {
    warnings.push("No samples to balance.");
    return { balanced: [], warnings };
  }

  const minCommon =
    commonCounts.length > 0 ? Math.min(...commonCounts) : RATIO_DENOMINATOR_FLOOR;
  const ratioBase = Math.max(minCommon, RATIO_DENOMINATOR_FLOOR);
  const ratioCap =
    ratioBase > 0 ? RATIO_CAP_MULTIPLIER * ratioBase : Number.MAX_SAFE_INTEGER;

  for (const l of RATIO_ANCHOR_LABELS) {
    const arr = byLabel.get(l)!;
    if (arr.length === 0) continue;
    const cap =
      l === "responsibility" || l === "requirement"
        ? Math.min(MAX_RESP_REQ, ratioCap)
        : ratioCap;
    if (arr.length > cap) {
      shuffleInPlace(arr);
      byLabel.set(l, arr.slice(0, cap));
    }
  }

  for (const l of ["experience", "contact", "position"] as const) {
    const arr = byLabel.get(l)!;
    if (arr.length > RARE_LABEL_MAX_POOL) {
      shuffleInPlace(arr);
      byLabel.set(l, arr.slice(0, RARE_LABEL_MAX_POOL));
    }
  }

  trimTotalToCap(byLabel, TARGET_MAX_TOTAL, MIN_FLOOR_TRIM);

  let balanced: TrainingSample[] = [];
  for (const l of LABEL_ORDER) balanced.push(...(byLabel.get(l) ?? []));
  shuffleInPlace(balanced);

  if (balanced.length < TARGET_MIN_TOTAL) {
    warnings.push(
      `Total row count ${balanced.length} is below target minimum ${TARGET_MIN_TOTAL}.`,
    );
  }

  if (balanced.length > TARGET_MAX_TOTAL) {
    warnings.push(
      `Could not trim dataset to ${TARGET_MAX_TOTAL} rows without violating per-label floors; size is ${balanced.length}.`,
    );
  }

  for (const [label, floor] of Object.entries(MIN_AFTER_BALANCE) as [
    string,
    number,
  ][]) {
    const n = balanced.filter((s) => s.label === label).length;
    if (n < floor) {
      warnings.push(
        `Label "${label}" has ${n} rows, below post-balance floor ${floor}.`,
      );
    }
  }

  return { balanced, warnings };
}

function previewQuarantineRows(rows: TrainingSample[], n: number): void {
  const copy = [...rows];
  shuffleInPlace(copy);
  const pick = copy.slice(0, Math.min(n, copy.length));
  console.log(`\n--- Low-confidence preview (${pick.length} of ${rows.length}) ---`);
  for (const s of pick) {
    console.log(JSON.stringify(s));
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const review = process.argv.includes("--review");
  const raw = await readFile(DATA_PATH, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Expected JSON array");

  const input: TrainingSample[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text : "";
    const label = typeof r.label === "string" ? r.label : "";
    if (text && label && VALID_LABELS.has(label)) input.push({ text, label });
  }

  const cleanedHigh: TrainingSample[] = [];
  const quarantine: TrainingSample[] = [];
  const seen = new Set<string>();

  for (const row of input) {
    const norm = normalizeText(row.text);
    if (isJunkLine(norm)) continue;

    const inferred = inferLabel(norm);
    const textOut = finalTextForLabel(norm, inferred.label);
    if (!textOut) continue;

    const key = dedupeKey(textOut, inferred.label);
    if (seen.has(key)) continue;
    seen.add(key);

    const sample: TrainingSample = {
      text: textOut,
      label: inferred.label,
      confidence: inferred.confidence,
    };
    if (inferred.confidence === "low") {
      quarantine.push(sample);
    } else {
      cleanedHigh.push(sample);
    }
  }

  const acceptedFromInput = cleanedHigh.length + quarantine.length;

  let syntheticRows = 0;
  if (!review) {
    for (const s of generateExperienceSamples()) {
      const key = dedupeKey(s.text, s.label);
      if (!seen.has(key)) {
        seen.add(key);
        cleanedHigh.push(s);
        syntheticRows += 1;
      }
    }
  }

  if (!review) {
    for (const label of LABEL_ORDER) {
      const have = countByLabel(cleanedHigh, label);
      const need = Math.max(0, MIN_PROMOTE_PER_LABEL - have);
      cleanedHigh.push(...promoteFromQuarantine(label, need, quarantine));
    }
    const otherHave = countByLabel(cleanedHigh, "other");
    const otherNeed = Math.max(0, MIN_PROMOTE_OTHER - otherHave);
    cleanedHigh.push(...promoteFromQuarantine("other", otherNeed, quarantine));
    for (const label of ["benefit", "experience"] as const) {
      const have = countByLabel(cleanedHigh, label);
      const need = Math.max(0, MIN_PROMOTE_BENEFIT_EXP - have);
      cleanedHigh.push(...promoteFromQuarantine(label, need, quarantine));
    }
  }

  const { balanced, warnings } = review
    ? { balanced: cleanedHigh, warnings: [] as string[] }
    : balanceDataset(cleanedHigh);

  const counts: Record<string, number> = {};
  for (const l of LABEL_ORDER) counts[l] = 0;
  for (const s of balanced) {
    counts[s.label] = (counts[s.label] ?? 0) + 1;
  }
  const otherPct = (counts.other ?? 0) / Math.max(1, balanced.length);

  const acceptedRows = cleanedHigh.length + quarantine.length;
  const report = {
    inputRows: input.length,
    acceptedRows,
    acceptedFromInput,
    outputRows: balanced.length,
    quarantineRows: quarantine.length,
    dropped: input.length - acceptedFromInput,
    otherPercent: Number((otherPct * 100).toFixed(2)),
    perLabel: counts,
    balanceWarnings: warnings,
    syntheticRows: review ? 0 : syntheticRows,
    dryRun,
    review,
  };
  if (warnings.length > 0) {
    console.warn("\n--- balance / floor warnings ---\n" + warnings.join("\n"));
  }
  console.log(JSON.stringify(report, null, 2));

  if (review) {
    previewQuarantineRows(quarantine, 20);
    if (!dryRun && quarantine.length > 0) {
      await writeFile(QUARANTINE_PATH, JSON.stringify(quarantine, null, 2), "utf8");
    }
    return;
  }

  if (!dryRun) {
    await writeFile(DATA_PATH, JSON.stringify(balanced, null, 2), "utf8");
    if (quarantine.length > 0) {
      await writeFile(QUARANTINE_PATH, JSON.stringify(quarantine, null, 2), "utf8");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
