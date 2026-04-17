import { detectSections } from "./sectionDetector.js";
import { extractEducation } from "./extractors/education.js";
import { extractExperience } from "./extractors/experience.js";
import { extractPersonal } from "./extractors/personal.js";
import { extractProjects } from "./extractors/projects.js";
import { extractSummary } from "./extractors/summary.js";
import type { ConfidenceLevel, ResumeStructured } from "./types.js";
import { setConfidence } from "./utils/confidence.js";

const EXTRACTION_VERSION = "resume-structured-v1";

function splitTokens(lines: string[]): string[] {
  const out = lines
    .flatMap((line) => line.split(/[|,;•]/g))
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 80);
  return [...new Set(out)];
}

function mergeConfidence(
  dst: Record<string, ConfidenceLevel>,
  src: Record<string, ConfidenceLevel>,
): void {
  for (const [key, level] of Object.entries(src)) {
    setConfidence(dst, key, level);
  }
}

export function extractResumeStructured(
  text: string,
  options?: { links?: string[] },
): ResumeStructured {
  const confidence: Record<string, ConfidenceLevel> = {};
  const sections = detectSections(text);

  const personal = extractPersonal(text, sections, options?.links);
  mergeConfidence(confidence, personal.confidence);

  const summary = extractSummary(text, sections);
  mergeConfidence(confidence, summary.confidence);

  const education = extractEducation(sections);
  mergeConfidence(confidence, education.confidence);

  const experience = extractExperience(sections);
  mergeConfidence(confidence, experience.confidence);

  const projects = extractProjects(sections);
  mergeConfidence(confidence, projects.confidence);

  const skills = splitTokens(sections.skills).slice(0, 80);
  if (skills.length) setConfidence(confidence, "skills", "high");

  const languages = splitTokens(sections.languages).slice(0, 20);
  if (languages.length) setConfidence(confidence, "languages", "high");

  const certifications = splitTokens(sections.certifications).slice(0, 40);
  if (certifications.length) setConfidence(confidence, "certifications", "high");

  return {
    personal: personal.personal,
    summary: summary.summary,
    skills: skills.length ? skills : undefined,
    languages: languages.length ? languages : undefined,
    certifications: certifications.length ? certifications : undefined,
    education: education.education.length ? education.education : undefined,
    experience: experience.experience.length ? experience.experience : undefined,
    projects: projects.projects.length ? projects.projects : undefined,
    meta: {
      confidence,
      extractionVersion: EXTRACTION_VERSION,
      socialSignals: personal.socialSignals,
    },
  };
}
