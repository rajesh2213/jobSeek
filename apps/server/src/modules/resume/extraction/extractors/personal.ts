import type { ConfidenceLevel, ResumeSections } from "../types.js";
import { normalizePhone, normalizeUrl } from "../utils/normalizers.js";

const COUNTRY_HINTS = new Set([
  "india",
  "united states",
  "usa",
  "united kingdom",
  "uk",
  "canada",
  "australia",
  "germany",
  "france",
  "singapore",
]);

function cleanLine(line: string): string {
  return line.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

function inferName(lines: string[]): { firstName?: string; lastName?: string } {
  for (const raw of lines.slice(0, 24)) {
    const line = cleanLine(raw);
    if (!line || line.length < 3 || line.length > 90) continue;
    if (/@|https?:\/\/|www\.|linkedin|github|portfolio|\d/.test(line.toLowerCase())) continue;
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 2 || parts.length > 4) continue;
    if (!parts.every((p) => /^[\p{L}][\p{L}'.-]*$/u.test(p))) continue;
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
  }
  return {};
}

function collectLinkCandidates(text: string, links?: string[]): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>)"']+/gi)) {
    const normalized = normalizeUrl(m[0]);
    if (normalized) out.add(normalized);
  }
  for (const raw of links ?? []) {
    const normalized = normalizeUrl(raw);
    if (normalized) out.add(normalized);
  }
  return [...out];
}

export function extractPersonal(
  text: string,
  sections: ResumeSections,
  links?: string[],
): {
  personal: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    city?: string;
    country?: string;
    linkedin?: string;
    github?: string;
    portfolio?: string;
  };
  confidence: Record<string, ConfidenceLevel>;
  socialSignals: {
    linkedinLabelSeen: boolean;
    githubLabelSeen: boolean;
    portfolioLabelSeen: boolean;
    linkedinUrlFound: boolean;
    githubUrlFound: boolean;
    portfolioUrlFound: boolean;
  };
} {
  const confidence: Record<string, ConfidenceLevel> = {};
  const out: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    city?: string;
    country?: string;
    linkedin?: string;
    github?: string;
    portfolio?: string;
  } = {};

  const lines = text.split("\n").map(cleanLine).filter(Boolean);
  const top = lines.slice(0, 30);
  const header = top.join(" | ").toLowerCase();
  const socialSignals = {
    linkedinLabelSeen: /\blinkedin\b/.test(header),
    githubLabelSeen: /\bgithub\b/.test(header),
    portfolioLabelSeen: /\bportfolio\b|\bwebsite\b|\bpersonal site\b/.test(header),
    linkedinUrlFound: false,
    githubUrlFound: false,
    portfolioUrlFound: false,
  };

  const name = inferName(top);
  if (name.firstName) {
    out.firstName = name.firstName.slice(0, 80);
    confidence["personal.firstName"] = "medium";
  }
  if (name.lastName) {
    out.lastName = name.lastName.slice(0, 120);
    confidence["personal.lastName"] = "medium";
  }

  const email = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
  if (email) {
    out.email = email.toLowerCase().slice(0, 200);
    confidence["personal.email"] = "high";
  }

  const phoneRaw = text.match(/(?:\+?\d[\d()\s.-]{7,}\d)/)?.[0];
  const phone = normalizePhone(phoneRaw);
  if (phone) {
    out.phone = phone;
    confidence["personal.phone"] = "high";
  }

  const allLinks = collectLinkCandidates(text, links);
  for (const link of allLinks) {
    const lower = link.toLowerCase();
    if (!out.linkedin && lower.includes("linkedin.com")) {
      out.linkedin = link;
      confidence["personal.linkedin"] = "high";
      socialSignals.linkedinUrlFound = true;
      continue;
    }
    if (!out.github && lower.includes("github.com")) {
      out.github = link;
      confidence["personal.github"] = "high";
      socialSignals.githubUrlFound = true;
      continue;
    }
    if (!out.portfolio && !lower.includes("linkedin.com") && !lower.includes("github.com")) {
      out.portfolio = link;
      confidence["personal.portfolio"] = "medium";
      socialSignals.portfolioUrlFound = true;
    }
  }

  const locationLine =
    top.find((l) => /location|based in|address/i.test(l) && l.length <= 120) ??
    top.find(
      (l) =>
        l.length <= 90 &&
        l.includes(",") &&
        !l.includes(":") &&
        !/@|https?:\/\//i.test(l) &&
        !/\d/.test(l) &&
        !/\b(experience|engineer|developer|building|focused|shipped|architected|skills?|languages?)\b/i.test(
          l,
        ),
    );
  if (locationLine) {
    const norm = locationLine.replace(/^location\s*[:\-]\s*/i, "");
    const parts = norm.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts[0]) {
      const cityToken = parts[0].includes("|")
        ? parts[0].split("|").map((x) => x.trim()).filter(Boolean).at(-1) ?? parts[0]
        : parts[0];
      out.city = cityToken.slice(0, 120);
      confidence["personal.city"] = "medium";
    }
    if (parts[1]) {
      out.country = parts[1].slice(0, 120);
      confidence["personal.country"] = "medium";
    }
  }

  if (!out.city && sections.other.length > 0) {
    const nearPhone = sections.other.find(
      (l) =>
        l.length <= 90 &&
        !l.includes(":") &&
        !/\b(skills?|languages?|frontend|backend|databases?)\b/i.test(l) &&
        /\b[A-Za-z .'-]+,\s*[A-Za-z .'-]+\b/.test(l),
    );
    if (nearPhone) {
      const parts = nearPhone.split(",").map((p) => p.trim()).filter(Boolean);
      if (parts[0] && !out.city) {
        out.city = parts[0].slice(0, 120);
        confidence["personal.city"] = "low";
      }
      if (parts[1] && !out.country) {
        out.country = parts[1].slice(0, 120);
        confidence["personal.country"] = "low";
      }
    }
  }

  if (!out.country) {
    const pipeHeaderLine = top.find((l) => l.includes("|"));
    if (pipeHeaderLine) {
      const tokens = pipeHeaderLine
        .split("|")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => t.replace(/\s+/g, " ").toLowerCase());
      const countryToken = tokens.find((t) => COUNTRY_HINTS.has(t));
      if (countryToken) {
        out.country = countryToken
          .split(" ")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ");
        confidence["personal.country"] = "high";
      }
    }
  }

  return { personal: out, confidence, socialSignals };
}
