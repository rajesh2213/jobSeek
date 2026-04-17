/**
 * Resolve simple application questions from stored profile without an LLM.
 * Returns null when the question should go to the model.
 */

export type StructuredProfile = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  workAuthorization: string | null;
  salaryExpectation: string | null;
  currentCompensation: string | null;
  availableFrom: string | null;
  noticePeriod: string | null;
  yearsOfExperience: number | null;
  currentTitle: string | null;
  currentCompany: string | null;
  professionalSummary: string | null;
  languages: string | null;
  certifications: string | null;
  highestEducation: string | null;
  relocationPreference: string | null;
  remotePreference: string | null;
};

const WORK_AUTH_LABEL: Record<string, string> = {
  citizen: "Citizen",
  permanent_resident: "Permanent Resident",
  visa_required: "Visa required",
  other: "Other",
};

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** If kind is free_text, skip heuristics unless question is clearly a single field. */
export function tryStructuredAnswer(
  question: string,
  p: StructuredProfile,
  kind?: "structured" | "free_text",
): string | null {
  const q = norm(question);
  if (q.length < 3) return null;

  if (kind === "free_text" && q.length > 120) {
    return null;
  }

  const pick = (val: string | null | undefined): string | null => {
    if (val == null || !String(val).trim()) return null;
    return String(val).trim();
  };

  if (/\b(e-?mail|email address)\b/i.test(question) && !/emergency/i.test(question)) {
    const v = pick(p.email);
    return v ?? null;
  }
  if (/\b(phone|mobile|cell|contact number|telephone)\b/i.test(question)) {
    return pick(p.phone);
  }
  if (/\bfirst\s*name\b|\bgiven\s*name\b/i.test(question)) {
    return pick(p.firstName);
  }
  if (/\blast\s*name\b|\bsurname\b|\bfamily\s*name\b/i.test(question)) {
    return pick(p.lastName);
  }
  if (/\blinkedin\b/i.test(question)) {
    return pick(p.linkedinUrl);
  }
  if (/\bgithub\b/i.test(question)) {
    return pick(p.githubUrl);
  }
  if (/\b(portfolio|personal\s*website|website\s*url)\b/i.test(question)) {
    return pick(p.portfolioUrl);
  }
  if (/\bstreet\s*address\b|\baddress\s*line\b|\bmailing\s*address\b/i.test(question)) {
    return pick(p.address);
  }
  if (/\bcity\b/i.test(question) && !/capacity|velocity/i.test(question)) {
    return pick(p.city);
  }
  if (/\b(country|nation)\b/i.test(question)) {
    return pick(p.country);
  }
  if (
    /\b(current|present)\s*(salary|compensation|pay)\b/i.test(q) ||
    /\bwhat.*\b(make|earn)\b/i.test(q)
  ) {
    return pick(p.currentCompensation);
  }
  if (
    /\b(expected|desired|target)\s*(salary|compensation|pay)\b/i.test(q) ||
    /\bsalary\s*expectation\b/i.test(q)
  ) {
    return pick(p.salaryExpectation);
  }
  if (/\bnotice\s*period\b/i.test(q)) {
    return pick(p.noticePeriod);
  }
  if (/\brelocat/i.test(q)) {
    return pick(p.relocationPreference);
  }
  if (/\b(remote|hybrid|onsite|work\s*from\s*home|wfh)\b/i.test(q) && q.length < 200) {
    return pick(p.remotePreference);
  }
  if (/\b(language|languages)\b/i.test(q) && q.length < 180) {
    return pick(p.languages);
  }
  if (/\b(certification|certificate)s?\b/i.test(q) && q.length < 200) {
    return pick(p.certifications);
  }
  if (/\b(education|degree|university|college)\b/i.test(q) && q.length < 200) {
    return pick(p.highestEducation);
  }
  if (/\b(years?\s*of\s*experience|yoe|total\s*experience)\b/i.test(q)) {
    if (p.yearsOfExperience != null) return String(p.yearsOfExperience);
    return null;
  }
  if (/\b(current|present)\s*(job\s*)?(title|position|role)\b/i.test(q)) {
    return pick(p.currentTitle);
  }
  if (/\b(current|present)\s*employer|\bcompany\s*name\b/i.test(q)) {
    return pick(p.currentCompany);
  }
  if (/\bwork\s*authorization\b|\beligible\s*to\s*work\b|\bvisa\s*sponsor/i.test(q)) {
    const w = p.workAuthorization;
    if (!w) return null;
    return WORK_AUTH_LABEL[w] ?? w;
  }
  if (/\bavailable\s*to\s*start\b|\bstart\s*date\b|\bavailability\b/i.test(q)) {
    return pick(p.availableFrom);
  }

  return null;
}
