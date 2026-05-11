import { isAtsPlaceholderCompanyName } from "../utils/companyDisplayName.js";

const PARSED_BUCKET_KEYS = [
  "position",
  "responsibility",
  "requirement",
  "experience",
  "benefit",
  "contact",
  "other",
] as const;

const WORKDAY_ROOT_JOB_PATH_SNIPPET = "myworkdayjobs.com/job/";

function parseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

export function hasNonemptyDescription(description: string | null | undefined): boolean {
  return Boolean(description && description.trim().length > 0);
}

export function hasUsableParsedDescription(parsedDescription: unknown): boolean {
  if (!parsedDescription || typeof parsedDescription !== "object" || Array.isArray(parsedDescription)) {
    return false;
  }
  const obj = parsedDescription as Record<string, unknown>;
  for (const key of PARSED_BUCKET_KEYS) {
    const value = obj[key];
    if (!Array.isArray(value) || value.length === 0) continue;
    if (value.some((line) => typeof line === "string" && line.trim().length > 0)) {
      return true;
    }
  }
  return false;
}

export function hasValidWorkdayUrlShape(source: string, sourceUrl: string): boolean {
  if (source !== "workday") return true;
  const trimmed = sourceUrl.trim();
  if (!trimmed) return false;
  const parsed = parseUrl(trimmed);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  if (!host.includes("myworkdayjobs.com")) return true;
  const path = parsed.pathname.toLowerCase();
  if (path.includes("/job/") && host.includes("myworkdayjobs.com")) {
    return !trimmed.toLowerCase().includes(WORKDAY_ROOT_JOB_PATH_SNIPPET);
  }
  return true;
}

export type JobQualityInput = {
  source: string;
  sourceUrl: string;
  description: string | null | undefined;
  parsedDescription: unknown;
};

export type JobQualityFlags = {
  hasNonemptyDescription: boolean;
  hasUsableParsed: boolean;
  hasValidWorkdayUrlShape: boolean;
  isPublishable: boolean;
  requiresRepair: boolean;
};

export function computeJobQualityFlags(input: JobQualityInput): JobQualityFlags {
  const hasDesc = hasNonemptyDescription(input.description);
  const hasUsableParsed = input.parsedDescription == null
    ? true
    : hasUsableParsedDescription(input.parsedDescription);
  const hasValidWorkdayShape = hasValidWorkdayUrlShape(input.source, input.sourceUrl);
  const isPublishable = hasDesc && hasUsableParsed && hasValidWorkdayShape;
  const requiresRepair = !isPublishable;
  return {
    hasNonemptyDescription: hasDesc,
    hasUsableParsed,
    hasValidWorkdayUrlShape: hasValidWorkdayShape,
    isPublishable,
    requiresRepair,
  };
}

export type CompanyQualityInput = {
  name: string;
  domain: string | null | undefined;
  atsType: string | null | undefined;
  atsBoardToken: string | null | undefined;
};

export type CompanyQualityFlags = {
  isPlaceholderCompany: boolean;
  isCompanyVerified: boolean;
  requiresCompanyRepair: boolean;
};

export function computeCompanyQualityFlags(input: CompanyQualityInput): CompanyQualityFlags {
  const isPlaceholderCompany = isAtsPlaceholderCompanyName(input.name);
  const isCompanyVerified = Boolean(
    (input.domain && input.domain.trim().length > 0) ||
      (input.atsType && input.atsType.trim().length > 0 && input.atsBoardToken && input.atsBoardToken.trim().length > 0),
  );
  return {
    isPlaceholderCompany,
    isCompanyVerified,
    requiresCompanyRepair: isPlaceholderCompany && !isCompanyVerified,
  };
}
