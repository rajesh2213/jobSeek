import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { resolveClerkUser } from "../../infrastructure/auth/clerkVerify.js";
import { getResumeObjectStore } from "../../infrastructure/storage/resumeObjectStore.js";
import { getPlanLimits } from "../../config/plans.js";
import { resolveProPlan } from "../../utils/userPlan.js";
import {
  buildPromptContext,
  extractProfileSummary,
  inferApplyFieldsFromResume,
  inferSocialUrlsFromResume,
  mergeInferredApplyFields,
  type ApplyProfileSummary,
} from "../../utils/resumeProfileExtractor.js";
import {
  extractApplyProfileWithLLM,
  generateApplyAnswers,
  type SmartApplyPreferencesShape,
} from "../../utils/smartApply.js";
import { tryStructuredAnswer, type StructuredProfile } from "../../utils/smartApplyStructured.js";
import { embedBullets } from "../../utils/resumeEmbedder.js";
import {
  hashResumeText,
  mimeTypeFromResumeFileName,
  normalizeResumePlainText,
  parseResumeFile,
} from "../../utils/resumeParser.js";
import { computeHasResumeFromParts, getResumeFileOctetLength } from "./resumePresence.js";
import { nextUtcMidnight, startOfUtcDay } from "../viewCap/viewCap.service.js";
import { extractResumeStructured } from "../resume/extraction/pipeline.js";
import type {
  ConfidenceLevel,
  ResumeStructured,
} from "../resume/extraction/types.js";

const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const WORK_AUTH = new Set(["citizen", "permanent_resident", "visa_required", "other"]);
const REMOTE_PREF = new Set(["remote", "hybrid", "onsite", "no_preference", ""]);

const MAX_STR = 5000;
const MAX_SUMMARY = 4000;
const MAX_QA = 30;
const SMART_APPLY_EVENTS = new Set([
  "resume_uploaded",
  "extension_installed_clicked",
  "ats_page_detected",
  "fields_detected_count",
  "fill_started",
  "fill_completed",
  "long_answer_generated_count",
  "answer_edited_before_apply",
  "session_to_first_success_time",
]);

type CustomQA = Array<{ question: string; answer: string }>;
type SmartApplyEventName =
  | "resume_uploaded"
  | "extension_installed_clicked"
  | "ats_page_detected"
  | "fields_detected_count"
  | "fill_started"
  | "fill_completed"
  | "long_answer_generated_count"
  | "answer_edited_before_apply"
  | "session_to_first_success_time";

/**
 * Dev-only bypass for the 1/day extract-profile cap.
 * Set DEV_SMART_APPLY_EXTRACT_BYPASS_DAILY_LIMIT=true in local env.
 */
function canBypassExtractDailyLimit(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_SMART_APPLY_EXTRACT_BYPASS_DAILY_LIMIT?.trim() === "true"
  );
}

/**
 * Dev-only bypass for Smart Apply daily usage cap.
 * Enabled when either:
 * - DEV_SMART_APPLY_BYPASS_DAILY_LIMIT=true
 * - DEV_EXTENSION_AUTH_BYPASS=true (common local extension workflow)
 */
function canBypassSmartApplyDailyLimit(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.DEV_SMART_APPLY_BYPASS_DAILY_LIMIT?.trim() === "true") return true;
  return process.env.DEV_EXTENSION_AUTH_BYPASS?.trim() === "true";
}

function isEmptyStr(v: string | null | undefined): boolean {
  return v == null || String(v).trim() === "";
}

/** True if `data[key]` is missing or blank (so we do not overwrite a value set earlier in the same request). */
function dataStrEmpty(data: Record<string, unknown>, key: string): boolean {
  const v = data[key];
  if (v === undefined) return true;
  return isEmptyStr(typeof v === "string" ? v : String(v));
}

function parseResumeStructured(raw: unknown): ResumeStructured | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!("personal" in o) || !("meta" in o)) return null;
  return o as ResumeStructured;
}

function confidenceAt(
  structured: ResumeStructured | null,
  key: string,
): ConfidenceLevel | undefined {
  return structured?.meta?.confidence?.[key];
}

function isHighConfidence(
  structured: ResumeStructured | null,
  key: string,
): boolean {
  return confidenceAt(structured, key) === "high";
}

function firstEducationOneLiner(structured: ResumeStructured): string | null {
  const e0 = structured.education?.[0];
  if (!e0) return null;
  const parts = [e0.degree, e0.course, e0.university]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(" - ").slice(0, 500);
}

function socialEvidenceMap(structured: ResumeStructured | null): {
  linkedinUrl: boolean;
  githubUrl: boolean;
  portfolioUrl: boolean;
} {
  const s = structured?.meta?.socialSignals;
  return {
    linkedinUrl: Boolean(s?.linkedinUrlFound || s?.linkedinLabelSeen),
    githubUrl: Boolean(s?.githubUrlFound || s?.githubLabelSeen),
    portfolioUrl: Boolean(s?.portfolioUrlFound || s?.portfolioLabelSeen),
  };
}

function parseSmartApplyPreferences(raw: unknown): Prisma.InputJsonValue | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid smartApplyPreferences");
  }
  const o = raw as Record<string, unknown>;
  const allowedTones = new Set(["professional", "friendly", "formal", "casual"]);
  const allowedLen = new Set(["short", "medium", "long"]);
  const out: Record<string, unknown> = {};
  if (typeof o.tone === "string" && allowedTones.has(o.tone)) out.tone = o.tone;
  if (typeof o.length === "string" && allowedLen.has(o.length)) out.length = o.length;
  if (typeof o.firstPerson === "boolean") out.firstPerson = o.firstPerson;
  return out as unknown as Prisma.InputJsonValue;
}

function prefsFromRow(raw: unknown): SmartApplyPreferencesShape | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    tone: o.tone as SmartApplyPreferencesShape["tone"],
    length: o.length as SmartApplyPreferencesShape["length"],
    firstPerson: typeof o.firstPerson === "boolean" ? o.firstPerson : true,
  };
}

/** Batch-answer body: partial tone/length/firstPerson merged over stored profile. */
function parsePreferenceOverrides(raw: unknown): Partial<SmartApplyPreferencesShape> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: Partial<SmartApplyPreferencesShape> = {};
  const allowedTones = new Set(["professional", "friendly", "formal", "casual"]);
  const allowedLen = new Set(["short", "medium", "long"]);
  if (typeof o.tone === "string" && allowedTones.has(o.tone)) {
    out.tone = o.tone as SmartApplyPreferencesShape["tone"];
  }
  if (typeof o.length === "string" && allowedLen.has(o.length)) {
    out.length = o.length as SmartApplyPreferencesShape["length"];
  }
  if (typeof o.firstPerson === "boolean") out.firstPerson = o.firstPerson;
  return out;
}

function userToStructuredProfile(row: {
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
}): StructuredProfile {
  return {
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    address: row.address,
    city: row.city,
    country: row.country,
    linkedinUrl: row.linkedinUrl,
    githubUrl: row.githubUrl,
    portfolioUrl: row.portfolioUrl,
    workAuthorization: row.workAuthorization,
    salaryExpectation: row.salaryExpectation,
    currentCompensation: row.currentCompensation,
    availableFrom: row.availableFrom,
    noticePeriod: row.noticePeriod,
    yearsOfExperience: row.yearsOfExperience,
    currentTitle: row.currentTitle,
    currentCompany: row.currentCompany,
    professionalSummary: row.professionalSummary,
    languages: row.languages,
    certifications: row.certifications,
    highestEducation: row.highestEducation,
    relocationPreference: row.relocationPreference,
    remotePreference: row.remotePreference,
  };
}

function parseCustomQA(raw: unknown): CustomQA | null {
  if (!Array.isArray(raw)) return null;
  const out: CustomQA = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const q = "question" in item && typeof item.question === "string" ? item.question.trim() : "";
    const a = "answer" in item && typeof item.answer === "string" ? item.answer.trim() : "";
    if (!q && !a) continue;
    out.push({ question: q.slice(0, 500), answer: a.slice(0, MAX_STR) });
    if (out.length >= MAX_QA) break;
  }
  return out;
}

function asSummary(
  raw: unknown,
  resumeText: string | null,
  bullets: string[] | null,
): ApplyProfileSummary {
  if (raw && typeof raw === "object" && raw !== null && "skills" in raw) {
    return raw as ApplyProfileSummary;
  }
  const text = resumeText ?? "";
  const b = bullets ?? [];
  return extractProfileSummary(text, b);
}

function computeProfileMetrics(user: {
  firstName: string | null;
  resumeText: string | null;
  resumeFileName: string | null;
  resumeFileOctets?: bigint | null;
  professionalSummary: string | null;
  lastName: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  linkedinUrl: string | null;
  currentTitle: string | null;
  yearsOfExperience: number | null;
  workAuthorization: string | null;
  salaryExpectation: string | null;
  availableFrom: string | null;
  customQA: unknown;
}): { profileComplete: boolean; profileCompletionPct: number } {
  const hasResume = computeHasResumeFromParts({
    resumeText: user.resumeText,
    resumeFileName: user.resumeFileName,
    fileOctets: user.resumeFileOctets ?? null,
  });
  const firstName = Boolean(user.firstName?.trim());
  const summary = Boolean(user.professionalSummary?.trim());
  const profileComplete = firstName && hasResume && summary;

  const checks = [
    firstName,
    Boolean(user.lastName?.trim()),
    Boolean(user.phone?.trim()),
    Boolean(user.city?.trim()),
    Boolean(user.country?.trim()),
    Boolean(user.linkedinUrl?.trim()),
    hasResume,
    Boolean(user.currentTitle?.trim()),
    user.yearsOfExperience != null,
    Boolean(user.workAuthorization?.trim()),
    Boolean(user.salaryExpectation?.trim()),
    Boolean(user.availableFrom?.trim()),
    summary,
    Array.isArray(user.customQA) && (user.customQA as unknown[]).length > 0,
  ];
  const filled = checks.filter(Boolean).length;
  const profileCompletionPct = Math.round((filled / checks.length) * 100);
  return { profileComplete, profileCompletionPct };
}

async function streamToBufferLimited(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const chunkAny: unknown = chunk;
    let b: Buffer;
    if (Buffer.isBuffer(chunkAny)) {
      b = chunkAny;
    } else if (typeof chunkAny === "string") {
      b = Buffer.from(chunkAny);
    } else if (ArrayBuffer.isView(chunkAny)) {
      b = Buffer.from(chunkAny.buffer, chunkAny.byteOffset, chunkAny.byteLength);
    } else if (chunkAny instanceof ArrayBuffer) {
      b = Buffer.from(chunkAny);
    } else {
      b = Buffer.from(String(chunkAny));
    }
    total += b.length;
    if (total > maxBytes) {
      throw new Error("Resume file too large");
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

async function loadResumeBytes(
  resumeFileKey: string | null,
  resumeFileData: Buffer | Uint8Array | null,
): Promise<Buffer | null> {
  if (resumeFileKey) {
    try {
      const obj = await getResumeObjectStore().getObject(resumeFileKey);
      if (obj) {
        const buff = await streamToBufferLimited(obj.stream, MAX_RESUME_BYTES);
        if (buff.length > 0) return buff;
      }
    } catch {
      // Fallback to legacy DB bytes during migration.
    }
  }
  if (!resumeFileData) return null;
  const buff = Buffer.from(resumeFileData);
  if (buff.length > MAX_RESUME_BYTES) {
    throw new Error("Resume file too large");
  }
  return buff.length > 0 ? buff : null;
}

async function ensureSmartApplyDayReset(
  prisma: FastifyInstance["prisma"],
  userId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { smartApplyResetAt: true },
  });
  if (!user) return;
  const dayStart = startOfUtcDay();
  if (user.smartApplyResetAt < dayStart) {
    await prisma.user.update({
      where: { id: userId },
      data: { smartApplyJobsToday: 0, smartApplyResetAt: new Date() },
    });
  }
}

export function registerAccountApplyProfileRoutes(server: FastifyInstance): void {
  server.get("/account/apply-profile", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const row = await server.prisma.user.findUnique({
      where: { id: ctx.internalUserId },
      select: {
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        address: true,
        city: true,
        country: true,
        linkedinUrl: true,
        githubUrl: true,
        portfolioUrl: true,
        workAuthorization: true,
        salaryExpectation: true,
        currentCompensation: true,
        availableFrom: true,
        noticePeriod: true,
        relocationPreference: true,
        remotePreference: true,
        yearsOfExperience: true,
        currentTitle: true,
        currentCompany: true,
        professionalSummary: true,
        languages: true,
        certifications: true,
        highestEducation: true,
        customQA: true,
        applyProfileSummary: true,
        smartApplyPreferences: true,
        applyProfileExtras: true,
        profileExtractLastAt: true,
        resumeText: true,
        resumeFileName: true,
        resumeUpdatedAt: true,
      },
    });

    if (!row) {
      return reply.status(404).send({ error: "User not found", code: "USER_NOT_FOUND" });
    }

    const fileOctetsGet = await getResumeFileOctetLength(server.prisma, ctx.internalUserId);
    const hasResume = computeHasResumeFromParts({
      resumeText: row.resumeText,
      resumeFileName: row.resumeFileName,
      fileOctets: fileOctetsGet,
    });
    const textNormGet = normalizeResumePlainText(row.resumeText);
    const wordCount = textNormGet.length ? textNormGet.split(/\s+/).filter(Boolean).length : 0;

    const customQA = (row.customQA as CustomQA | null) ?? [];
    const resumeText = row.resumeText ?? "";
    const resumeEmailMatch = resumeText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const accountEmail = row.email?.trim() ?? "";
    const isSyntheticEmail = accountEmail.endsWith("@users.clerk.local");
    const resumeEmail = resumeEmailMatch?.[0]?.trim() ?? "";
    const responseEmail = !isSyntheticEmail && accountEmail ? accountEmail : resumeEmail || null;

    return reply.send({
      email: responseEmail,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      address: row.address,
      city: row.city,
      country: row.country,
      linkedinUrl: row.linkedinUrl,
      githubUrl: row.githubUrl,
      portfolioUrl: row.portfolioUrl,
      workAuthorization: row.workAuthorization,
      salaryExpectation: row.salaryExpectation,
      currentCompensation: row.currentCompensation,
      availableFrom: row.availableFrom,
      noticePeriod: row.noticePeriod,
      relocationPreference: row.relocationPreference,
      remotePreference: row.remotePreference,
      yearsOfExperience: row.yearsOfExperience,
      currentTitle: row.currentTitle,
      currentCompany: row.currentCompany,
      professionalSummary: row.professionalSummary,
      languages: row.languages,
      certifications: row.certifications,
      highestEducation: row.highestEducation,
      customQA,
      applyProfileSummary: row.applyProfileSummary,
      smartApplyPreferences: row.smartApplyPreferences,
      applyProfileExtras: row.applyProfileExtras,
      profileExtractLastAt: row.profileExtractLastAt?.toISOString() ?? null,
      extractDailyLimitBypassed: canBypassExtractDailyLimit(),
      hasResume,
      resumeFileName: row.resumeFileName,
      resumeUpdatedAt: row.resumeUpdatedAt?.toISOString() ?? null,
      resumeWordCount: wordCount,
    });
  });

  server.patch<{
    Body: Partial<{
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
      relocationPreference: string | null;
      remotePreference: string | null;
      yearsOfExperience: number | null;
      currentTitle: string | null;
      currentCompany: string | null;
      professionalSummary: string | null;
      languages: string | null;
      certifications: string | null;
      highestEducation: string | null;
      customQA: CustomQA;
      smartApplyPreferences: Record<string, unknown> | null;
      applyProfileExtras: unknown;
    }>;
  }>("/account/apply-profile", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const body = request.body ?? {};
    const data: Record<string, unknown> = {};

    const setStr = (key: string, val: unknown, max = MAX_STR) => {
      if (val === undefined) return;
      if (val === null) {
        data[key] = null;
        return;
      }
      if (typeof val !== "string") {
        throw new Error(`Invalid ${key}`);
      }
      data[key] = val.trim().slice(0, max);
    };

    try {
      setStr("firstName", body.firstName, 200);
      setStr("lastName", body.lastName, 200);
      setStr("phone", body.phone, 80);
      setStr("address", body.address, 500);
      setStr("city", body.city, 120);
      setStr("country", body.country, 120);
      setStr("linkedinUrl", body.linkedinUrl, 500);
      setStr("githubUrl", body.githubUrl, 500);
      setStr("portfolioUrl", body.portfolioUrl, 500);
      setStr("salaryExpectation", body.salaryExpectation, 200);
      setStr("currentCompensation", body.currentCompensation, 200);
      setStr("availableFrom", body.availableFrom, 120);
      setStr("noticePeriod", body.noticePeriod, 120);
      setStr("relocationPreference", body.relocationPreference, 200);
      setStr("currentTitle", body.currentTitle, 200);
      setStr("currentCompany", body.currentCompany, 200);
      setStr("professionalSummary", body.professionalSummary, MAX_SUMMARY);
      setStr("languages", body.languages, 500);
      setStr("certifications", body.certifications, MAX_SUMMARY);
      setStr("highestEducation", body.highestEducation, 500);

      if (body.remotePreference !== undefined) {
        if (body.remotePreference === null) {
          data.remotePreference = null;
        } else if (typeof body.remotePreference === "string") {
          const r = body.remotePreference.trim();
          if (r && !REMOTE_PREF.has(r)) {
            return reply.status(400).send({
              error: "Invalid remotePreference",
              code: "INVALID_BODY",
            });
          }
          data.remotePreference = r || null;
        } else {
          return reply.status(400).send({ error: "Invalid remotePreference", code: "INVALID_BODY" });
        }
      }

      if (body.smartApplyPreferences !== undefined) {
        if (body.smartApplyPreferences === null) {
          data.smartApplyPreferences = Prisma.DbNull;
        } else {
          try {
            const parsed = parseSmartApplyPreferences(body.smartApplyPreferences);
            if (parsed !== undefined) data.smartApplyPreferences = parsed;
          } catch {
            return reply.status(400).send({ error: "Invalid smartApplyPreferences", code: "INVALID_BODY" });
          }
        }
      }

      if (body.applyProfileExtras !== undefined) {
        if (body.applyProfileExtras === null) {
          data.applyProfileExtras = Prisma.DbNull;
        } else if (typeof body.applyProfileExtras === "object") {
          data.applyProfileExtras = body.applyProfileExtras as Prisma.InputJsonValue;
        } else {
          return reply.status(400).send({ error: "Invalid applyProfileExtras", code: "INVALID_BODY" });
        }
      }

      if (body.workAuthorization !== undefined) {
        if (body.workAuthorization === null) {
          data.workAuthorization = null;
        } else if (typeof body.workAuthorization === "string") {
          const w = body.workAuthorization.trim();
          if (w && !WORK_AUTH.has(w)) {
            return reply.status(400).send({
              error: "Invalid workAuthorization",
              code: "INVALID_BODY",
            });
          }
          data.workAuthorization = w || null;
        } else {
          return reply.status(400).send({ error: "Invalid workAuthorization", code: "INVALID_BODY" });
        }
      }

      if (body.yearsOfExperience !== undefined) {
        if (body.yearsOfExperience === null) {
          data.yearsOfExperience = null;
        } else if (
          typeof body.yearsOfExperience === "number" &&
          Number.isFinite(body.yearsOfExperience) &&
          body.yearsOfExperience >= 0 &&
          body.yearsOfExperience <= 80
        ) {
          data.yearsOfExperience = Math.floor(body.yearsOfExperience);
        } else {
          return reply.status(400).send({ error: "Invalid yearsOfExperience", code: "INVALID_BODY" });
        }
      }

      if (body.customQA !== undefined) {
        const qa = parseCustomQA(body.customQA);
        if (qa === null) {
          return reply.status(400).send({ error: "Invalid customQA", code: "INVALID_BODY" });
        }
        data.customQA = qa;
      }
    } catch {
      return reply.status(400).send({ error: "Invalid body", code: "INVALID_BODY" });
    }

    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ error: "No fields to update", code: "INVALID_BODY" });
    }

    await server.prisma.user.update({
      where: { id: ctx.internalUserId },
      data: data as Prisma.UserUpdateInput,
    });

    const row = await server.prisma.user.findUnique({
      where: { id: ctx.internalUserId },
      select: {
        firstName: true,
        lastName: true,
        phone: true,
        address: true,
        city: true,
        country: true,
        linkedinUrl: true,
        githubUrl: true,
        portfolioUrl: true,
        workAuthorization: true,
        salaryExpectation: true,
        currentCompensation: true,
        availableFrom: true,
        noticePeriod: true,
        relocationPreference: true,
        remotePreference: true,
        yearsOfExperience: true,
        currentTitle: true,
        currentCompany: true,
        professionalSummary: true,
        languages: true,
        certifications: true,
        highestEducation: true,
        customQA: true,
        applyProfileSummary: true,
        smartApplyPreferences: true,
        applyProfileExtras: true,
        profileExtractLastAt: true,
        resumeText: true,
        resumeFileName: true,
        resumeUpdatedAt: true,
      },
    });

    if (!row) {
      return reply.status(404).send({ error: "User not found", code: "USER_NOT_FOUND" });
    }

    const fileOctetsPatch = await getResumeFileOctetLength(server.prisma, ctx.internalUserId);
    const hasResume = computeHasResumeFromParts({
      resumeText: row.resumeText,
      resumeFileName: row.resumeFileName,
      fileOctets: fileOctetsPatch,
    });
    const textNormPatch = normalizeResumePlainText(row.resumeText);
    const wordCount = textNormPatch.length
      ? textNormPatch.split(/\s+/).filter(Boolean).length
      : 0;

    const customQA = (row.customQA as CustomQA | null) ?? [];

    return reply.send({
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      address: row.address,
      city: row.city,
      country: row.country,
      linkedinUrl: row.linkedinUrl,
      githubUrl: row.githubUrl,
      portfolioUrl: row.portfolioUrl,
      workAuthorization: row.workAuthorization,
      salaryExpectation: row.salaryExpectation,
      currentCompensation: row.currentCompensation,
      availableFrom: row.availableFrom,
      noticePeriod: row.noticePeriod,
      relocationPreference: row.relocationPreference,
      remotePreference: row.remotePreference,
      yearsOfExperience: row.yearsOfExperience,
      currentTitle: row.currentTitle,
      currentCompany: row.currentCompany,
      professionalSummary: row.professionalSummary,
      languages: row.languages,
      certifications: row.certifications,
      highestEducation: row.highestEducation,
      customQA,
      applyProfileSummary: row.applyProfileSummary,
      smartApplyPreferences: row.smartApplyPreferences,
      applyProfileExtras: row.applyProfileExtras,
      profileExtractLastAt: row.profileExtractLastAt?.toISOString() ?? null,
      extractDailyLimitBypassed: canBypassExtractDailyLimit(),
      hasResume,
      resumeFileName: row.resumeFileName,
      resumeUpdatedAt: row.resumeUpdatedAt?.toISOString() ?? null,
      resumeWordCount: wordCount,
    });
  });

  server.post("/account/resume/extract-profile", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    let user = await server.prisma.user.findUnique({
      where: { id: ctx.internalUserId },
    });

    if (!user) {
      return reply.status(404).send({ error: "User not found", code: "USER_NOT_FOUND" });
    }

    let text = normalizeResumePlainText(user.resumeText);

    const resumeFileKey =
      typeof (user as Record<string, unknown>).resumeFileKey === "string"
        ? ((user as Record<string, unknown>).resumeFileKey as string)
        : null;
    let resumeBytes: Buffer | null = null;
    try {
      resumeBytes = await loadResumeBytes(resumeFileKey, user.resumeFileData ?? null);
    } catch (err) {
      return reply.status(400).send({
        error: "Resume parse failed",
        code: "RESUME_PARSE_FAILED",
        message:
          err instanceof Error
            ? err.message
            : "Could not read your stored resume. Please upload again.",
      });
    }
    const fileDataLen = resumeBytes?.byteLength ?? 0;

    // Stored file but missing/empty parsed text (legacy rows, failed partial writes, etc.): re-parse bytes.
    if (!text && fileDataLen > 0 && resumeBytes) {
      try {
        const mime = mimeTypeFromResumeFileName(user.resumeFileName ?? undefined);
        if (
          mime !== "application/pdf" &&
          mime !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
          mime !== "text/plain"
        ) {
          return reply.status(400).send({
            error: "Unsupported resume format",
            code: "RESUME_UNSUPPORTED",
            message: "Could not detect PDF or Word from the stored file name. Re-upload your resume.",
          });
        }
        const parsed = await parseResumeFile(resumeBytes, mime);
        const t = normalizeResumePlainText(parsed.text);
        if (!t) {
          return reply.status(400).send({
            error: "Resume text empty",
            code: "RESUME_PARSE_EMPTY",
            message:
              "We could not extract text from your stored file. Try re-uploading the resume (PDF or DOCX).",
          });
        }
        let embeddings: number[][];
        try {
          embeddings = await embedBullets(parsed.bullets);
        } catch {
          return reply.status(503).send({
            error: "Service unavailable",
            message: "Embedding service unavailable",
          });
        }
        const summary = extractProfileSummary(parsed.text, parsed.bullets);
        const structured = extractResumeStructured(parsed.text, { links: parsed.links });
        const extractedResumeData: Record<string, unknown> = {
          resumeText: parsed.text,
          resumeBullets: parsed.bullets,
          resumeBulletEmbeddings: embeddings,
          resumeContentHash: hashResumeText(parsed.text),
          resumeStructuredV1: structured as unknown as Prisma.InputJsonValue,
          applyProfileSummary: summary as unknown as Prisma.InputJsonValue,
        };
        await server.prisma.user.update({
          where: { id: ctx.internalUserId },
          data: extractedResumeData as Prisma.UserUncheckedUpdateInput,
        });
        text = t;
        user = await server.prisma.user.findUnique({
          where: { id: ctx.internalUserId },
        });
        if (!user) {
          return reply.status(404).send({ error: "User not found", code: "USER_NOT_FOUND" });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Parse failed";
        return reply.status(400).send({
          error: "Resume parse failed",
          code: "RESUME_PARSE_FAILED",
          message: `Could not read your stored resume (${msg}). Please upload again.`,
        });
      }
    }

    if (!text) {
      const fn = user.resumeFileName?.trim();
      const message =
        fn && fileDataLen === 0
          ? "Your profile lists a resume file, but no file data is stored. Please upload your resume again."
          : fn
            ? "We could not read resume text. Try uploading your resume again (PDF or DOCX)."
            : "Upload a resume first.";
      return reply.status(400).send({
        error: "No resume on file",
        code: "NO_RESUME",
        message,
      });
    }

    const now = new Date();
    const dayStart = startOfUtcDay(now);
    const bypassExtractDailyLimit = canBypassExtractDailyLimit();
    if (!bypassExtractDailyLimit && user.profileExtractLastAt && user.profileExtractLastAt >= dayStart) {
      return reply.status(429).send({
        error: "Profile extract limit reached",
        code: "EXTRACT_LIMIT",
        resetAt: nextUtcMidnight(now).toISOString(),
        message: "You can refresh your profile from your resume once per day",
      });
    }

    const bullets = (user.resumeBullets as string[] | null) ?? [];
    const fileName = user.resumeFileName ?? undefined;
    const summary = extractProfileSummary(text, bullets);
    const inferred = inferApplyFieldsFromResume(text, summary, { fileName });

    const mergedBasic = mergeInferredApplyFields(
      {
        firstName: user.firstName,
        lastName: user.lastName,
        currentTitle: user.currentTitle,
        yearsOfExperience: user.yearsOfExperience,
        professionalSummary: user.professionalSummary,
      },
      inferred,
    );

    const data: Record<string, unknown> = {
      ...mergedBasic,
      applyProfileSummary: summary as unknown as Prisma.InputJsonValue,
    };

    let structured = parseResumeStructured((user as unknown as Record<string, unknown>).resumeStructuredV1);
    const socialSignals = structured?.meta?.socialSignals;
    const needsBinaryLinkRecovery =
      Boolean(structured) &&
      Boolean(
        (socialSignals?.linkedinLabelSeen && !socialSignals.linkedinUrlFound) ||
          (socialSignals?.githubLabelSeen && !socialSignals.githubUrlFound) ||
          (socialSignals?.portfolioLabelSeen && !socialSignals.portfolioUrlFound),
      ) &&
      fileDataLen > 0 &&
      Boolean(resumeBytes);
    if (needsBinaryLinkRecovery && resumeBytes) {
      try {
        const mime = mimeTypeFromResumeFileName(user.resumeFileName ?? undefined);
        if (
          mime === "application/pdf" ||
          mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          mime === "text/plain"
        ) {
          const reparsed = await parseResumeFile(resumeBytes, mime);
          structured = extractResumeStructured(reparsed.text, { links: reparsed.links });
          const structuredUpdateData: Record<string, unknown> = {
            resumeStructuredV1: structured as unknown as Prisma.InputJsonValue,
          };
          await server.prisma.user.update({
            where: { id: ctx.internalUserId },
            data: structuredUpdateData as Prisma.UserUncheckedUpdateInput,
          });
        }
      } catch {
        // Best-effort only; keep existing structured payload if binary link recovery fails.
      }
    }

    if (structured) {
      const p = structured.personal ?? {};
      if (isEmptyStr(user.firstName) && isHighConfidence(structured, "personal.firstName") && p.firstName?.trim()) {
        data.firstName = p.firstName.trim().slice(0, 200);
      }
      if (isEmptyStr(user.lastName) && isHighConfidence(structured, "personal.lastName") && p.lastName?.trim()) {
        data.lastName = p.lastName.trim().slice(0, 200);
      }
      if (isEmptyStr(user.phone) && isHighConfidence(structured, "personal.phone") && p.phone?.trim()) {
        data.phone = p.phone.trim().slice(0, 80);
      }
      if (isEmptyStr(user.city) && isHighConfidence(structured, "personal.city") && p.city?.trim()) {
        data.city = p.city.trim().slice(0, 120);
      }
      if (isEmptyStr(user.country) && isHighConfidence(structured, "personal.country") && p.country?.trim()) {
        data.country = p.country.trim().slice(0, 120);
      }
      if (
        isEmptyStr(user.linkedinUrl) &&
        isHighConfidence(structured, "personal.linkedin") &&
        p.linkedin?.trim()
      ) {
        data.linkedinUrl = p.linkedin.trim().slice(0, 500);
      }
      if (isEmptyStr(user.githubUrl) && isHighConfidence(structured, "personal.github") && p.github?.trim()) {
        data.githubUrl = p.github.trim().slice(0, 500);
      }
      if (
        isEmptyStr(user.portfolioUrl) &&
        (isHighConfidence(structured, "personal.portfolio") ||
          structured.meta?.socialSignals?.portfolioUrlFound === true) &&
        p.portfolio?.trim()
      ) {
        data.portfolioUrl = p.portfolio.trim().slice(0, 500);
      }
      if (
        isEmptyStr(user.professionalSummary) &&
        isHighConfidence(structured, "summary") &&
        structured.summary?.trim()
      ) {
        data.professionalSummary = structured.summary.trim().slice(0, MAX_SUMMARY);
      }
      if (
        isEmptyStr(user.languages) &&
        isHighConfidence(structured, "languages") &&
        Array.isArray(structured.languages) &&
        structured.languages.length
      ) {
        data.languages = structured.languages.join(", ").slice(0, 500);
      }
      if (
        isEmptyStr(user.certifications) &&
        isHighConfidence(structured, "certifications") &&
        Array.isArray(structured.certifications) &&
        structured.certifications.length
      ) {
        data.certifications = structured.certifications.join(", ").slice(0, MAX_SUMMARY);
      }
      if (isEmptyStr(user.highestEducation) && isHighConfidence(structured, "education")) {
        const eduLine = firstEducationOneLiner(structured);
        if (eduLine) data.highestEducation = eduLine;
      }
      if (isEmptyStr(user.currentTitle) && isHighConfidence(structured, "experience")) {
        const exp0 = structured.experience?.[0];
        if (exp0?.role?.trim()) data.currentTitle = exp0.role.trim().slice(0, 200);
        if (isEmptyStr(user.currentCompany) && exp0?.company?.trim()) {
          data.currentCompany = exp0.company.trim().slice(0, 200);
        }
        if (user.yearsOfExperience == null) {
          const duration = exp0?.durationYears;
          if (typeof duration === "number" && duration >= 0 && duration <= 80) {
            data.yearsOfExperience = Math.floor(duration);
          }
        }
      }
    }

    if (isEmptyStr(user.highestEducation) && summary.education[0]?.trim()) {
      data.highestEducation = summary.education[0].trim().slice(0, 500);
    }

    const social = inferSocialUrlsFromResume(text);
    if (isEmptyStr(user.linkedinUrl) && social.linkedinUrl) {
      data.linkedinUrl = social.linkedinUrl;
    }
    if (isEmptyStr(user.githubUrl) && social.githubUrl) {
      data.githubUrl = social.githubUrl;
    }
    if (isEmptyStr(user.portfolioUrl) && social.portfolioUrl) {
      data.portfolioUrl = social.portfolioUrl;
    }

    const socialEvidence = socialEvidenceMap(structured);
    const criticalFields: Array<{
      userKey:
        | "firstName"
        | "lastName"
        | "phone"
        | "linkedinUrl"
        | "githubUrl"
        | "portfolioUrl"
        | "professionalSummary";
      confidenceKey?: string;
      conditional?: boolean;
    }> = [
      { userKey: "firstName", confidenceKey: "personal.firstName" },
      { userKey: "lastName", confidenceKey: "personal.lastName" },
      { userKey: "phone", confidenceKey: "personal.phone" },
      {
        userKey: "linkedinUrl",
        confidenceKey: "personal.linkedin",
        conditional: !socialEvidence.linkedinUrl,
      },
      {
        userKey: "githubUrl",
        confidenceKey: "personal.github",
        conditional: !socialEvidence.githubUrl,
      },
      {
        userKey: "portfolioUrl",
        confidenceKey: "personal.portfolio",
        conditional: !socialEvidence.portfolioUrl,
      },
      { userKey: "professionalSummary", confidenceKey: "summary" },
    ];
    const effectiveCritical = criticalFields.filter((f) => !f.conditional);
    const missingCriticalKeys = effectiveCritical
      .filter(({ userKey }) => {
        const cur = user[userKey];
        const pending = data[userKey];
        const curS = typeof cur === "string" ? cur : cur == null ? "" : String(cur);
        const pendingS =
          typeof pending === "string" ? pending : pending == null ? "" : String(pending);
        return isEmptyStr(curS) && isEmptyStr(pendingS);
      })
      .map((f) => f.userKey);
    const missingCritical = missingCriticalKeys.length > 0;
    const lowConfidenceCriticalKeys =
      structured == null
        ? []
        : effectiveCritical
            .filter(
              ({ confidenceKey }) =>
                Boolean(confidenceKey) && confidenceAt(structured, confidenceKey!) === "low",
            )
            .map((f) => f.userKey);
    const lowConfidenceCritical = lowConfidenceCriticalKeys.length > 0;

    const shouldCallLlm = missingCritical || lowConfidenceCritical;
    const llmReason = shouldCallLlm
      ? missingCritical
        ? "missing_critical"
        : "low_confidence_critical"
      : "deterministic_only";

    server.log.info(
      {
        route: "/account/resume/extract-profile",
        llmFallback: shouldCallLlm,
        llmReason,
        missingCriticalKeys,
        lowConfidenceCriticalKeys,
        socialEvidence,
      },
      "Resume extract decision",
    );

    // LLM is now a fallback: only run when deterministic extraction still leaves critical gaps.
    const llm = shouldCallLlm ? await extractApplyProfileWithLLM(text) : null;
    if (llm) {
      const strFields: Array<keyof typeof llm> = [
        "firstName",
        "lastName",
        "phone",
        "city",
        "country",
        "linkedinUrl",
        "githubUrl",
        "portfolioUrl",
        "currentTitle",
        "currentCompany",
        "professionalSummary",
        "languages",
        "certifications",
        "highestEducation",
      ];
      for (const k of strFields) {
        const v = llm[k];
        if (typeof v !== "string" || !v.trim()) continue;
        const cur = user[k as keyof typeof user];
        if (k === "firstName" || k === "lastName") {
          if (isEmptyStr(cur as string | null)) data[k] = v.trim().slice(0, 200);
        } else if (k === "phone") {
          if (isEmptyStr(user.phone)) data.phone = v.trim().slice(0, 80);
        } else if (k === "city") {
          if (isEmptyStr(user.city)) data.city = v.trim().slice(0, 120);
        } else if (k === "country") {
          if (isEmptyStr(user.country)) data.country = v.trim().slice(0, 120);
        } else if (k === "linkedinUrl") {
          if (isEmptyStr(user.linkedinUrl) && dataStrEmpty(data, "linkedinUrl")) {
            data.linkedinUrl = v.trim().slice(0, 500);
          }
        } else if (k === "githubUrl") {
          if (isEmptyStr(user.githubUrl) && dataStrEmpty(data, "githubUrl")) {
            data.githubUrl = v.trim().slice(0, 500);
          }
        } else if (k === "portfolioUrl") {
          if (isEmptyStr(user.portfolioUrl) && dataStrEmpty(data, "portfolioUrl")) {
            data.portfolioUrl = v.trim().slice(0, 500);
          }
        } else if (k === "currentTitle") {
          if (isEmptyStr(user.currentTitle)) data.currentTitle = v.trim().slice(0, 200);
        } else if (k === "currentCompany") {
          if (isEmptyStr(user.currentCompany)) data.currentCompany = v.trim().slice(0, 200);
        } else if (k === "professionalSummary") {
          if (isEmptyStr(user.professionalSummary)) data.professionalSummary = v.trim().slice(0, MAX_SUMMARY);
        } else if (k === "languages") {
          if (isEmptyStr(user.languages)) data.languages = v.trim().slice(0, 500);
        } else if (k === "certifications") {
          if (isEmptyStr(user.certifications)) data.certifications = v.trim().slice(0, MAX_SUMMARY);
        } else if (k === "highestEducation") {
          if (isEmptyStr(user.highestEducation)) data.highestEducation = v.trim().slice(0, 500);
        }
      }
      if (user.yearsOfExperience == null && typeof llm.yearsOfExperience === "number") {
        const y = Math.floor(llm.yearsOfExperience);
        if (y >= 0 && y <= 80) data.yearsOfExperience = y;
      }
    }

    data.profileExtractLastAt = now;

    await server.prisma.user.update({
      where: { id: ctx.internalUserId },
      data: data as Prisma.UserUpdateInput,
    });

    return reply.send({
      success: true,
      mergedFields: Object.keys(data).filter((k) => k !== "profileExtractLastAt"),
      resetAt: nextUtcMidnight(now).toISOString(),
    });
  });

  server.get("/account/smart-apply/status", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    await ensureSmartApplyDayReset(server.prisma, ctx.internalUserId);

    const row = await server.prisma.user.findUnique({
      where: { id: ctx.internalUserId },
      select: {
        plan: true,
        smartApplyJobsToday: true,
        firstName: true,
        lastName: true,
        phone: true,
        city: true,
        country: true,
        linkedinUrl: true,
        currentTitle: true,
        yearsOfExperience: true,
        workAuthorization: true,
        salaryExpectation: true,
        availableFrom: true,
        professionalSummary: true,
        resumeText: true,
        resumeFileName: true,
        customQA: true,
      },
    });

    if (!row) {
      return reply.status(404).send({ error: "User not found", code: "USER_NOT_FOUND" });
    }

    const resumeFileOctets = await getResumeFileOctetLength(server.prisma, ctx.internalUserId);

    const effective = await resolveProPlan(server.prisma, ctx.internalUserId, ctx.email);
    const limits = getPlanLimits(effective.plan);
    const bypassSmartApplyLimit = canBypassSmartApplyDailyLimit();
    const jobsLimit = bypassSmartApplyLimit ? 999_999 : limits.smartApplyJobs;
    const jobsToday = row.smartApplyJobsToday;
    const jobsRemaining = Math.max(0, jobsLimit - jobsToday);
    const { profileComplete, profileCompletionPct } = computeProfileMetrics({
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      city: row.city,
      country: row.country,
      linkedinUrl: row.linkedinUrl,
      currentTitle: row.currentTitle,
      yearsOfExperience: row.yearsOfExperience,
      workAuthorization: row.workAuthorization,
      salaryExpectation: row.salaryExpectation,
      availableFrom: row.availableFrom,
      professionalSummary: row.professionalSummary,
      resumeText: row.resumeText,
      resumeFileName: row.resumeFileName,
      resumeFileOctets,
      customQA: row.customQA,
    });

    return reply.send({
      jobsToday,
      jobsLimit,
      jobsRemaining,
      resetsAt: nextUtcMidnight().toISOString(),
      plan: effective.plan,
      profileComplete,
      profileCompletionPct,
      smartApplyDailyLimitBypassed: bypassSmartApplyLimit,
    });
  });

  server.post<{
    Body: {
      event?: SmartApplyEventName;
      payload?: Record<string, unknown>;
    };
  }>("/account/smart-apply/events", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const event = request.body?.event;
    if (!event || !SMART_APPLY_EVENTS.has(event)) {
      return reply.status(400).send({ error: "Invalid event", code: "INVALID_EVENT" });
    }

    const payload =
      request.body?.payload && typeof request.body.payload === "object"
        ? request.body.payload
        : {};

    server.log.info(
      {
        event,
        userId: ctx.internalUserId,
        payload,
      },
      "smart_apply_event",
    );

    return reply.send({ success: true });
  });

  server.post<{
    Body: {
      questions?: Array<{
        id: string;
        question: string;
        charLimit?: number;
        kind?: "structured" | "free_text";
      }>;
      jobTitle?: string;
      companyName?: string;
      jobId?: string;
      preferenceOverrides?: Record<string, unknown>;
    };
  }>("/account/smart-apply/batch-answer", async (request, reply) => {
    const ctx = await resolveClerkUser(server.prisma, request.headers.authorization);
    if (!ctx) {
      return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }

    const row = await server.prisma.user.findUnique({
      where: { id: ctx.internalUserId },
    });

    if (!row) {
      return reply.status(404).send({ error: "User not found", code: "USER_NOT_FOUND" });
    }

    const effective = await resolveProPlan(server.prisma, ctx.internalUserId, ctx.email);
    const limits = getPlanLimits(effective.plan);
    if (limits.smartApplyJobs === 0) {
      return reply.status(403).send({
        error: "Upgrade to Pro",
        code: "PRO_REQUIRED",
        message: "Upgrade to Pro to use Smart Apply",
      });
    }

    await ensureSmartApplyDayReset(server.prisma, ctx.internalUserId);

    const refreshed = await server.prisma.user.findUnique({
      where: { id: ctx.internalUserId },
    });
    if (!refreshed) {
      return reply.status(404).send({ error: "User not found", code: "USER_NOT_FOUND" });
    }

    const cap = limits.smartApplyJobs;
    if (!canBypassSmartApplyDailyLimit() && refreshed.smartApplyJobsToday >= cap) {
      return reply.status(429).send({
        error: "Daily Smart Apply limit reached",
        code: "SMART_APPLY_LIMIT",
        resetAt: nextUtcMidnight().toISOString(),
      });
    }

    const body = request.body ?? {};
    const questions = Array.isArray(body.questions) ? body.questions : [];
    const jobTitle = typeof body.jobTitle === "string" ? body.jobTitle.trim() : "";
    const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";

    if (!questions.length || !jobTitle || !companyName) {
      return reply.status(400).send({
        error: "questions, jobTitle, and companyName are required",
        code: "INVALID_BODY",
      });
    }

    const bullets = (refreshed.resumeBullets as string[] | null) ?? [];
    const summary = asSummary(refreshed.applyProfileSummary, refreshed.resumeText, bullets);

    const customQA = (parseCustomQA(refreshed.customQA) ?? []) as CustomQA;

    const firstName = refreshed.firstName?.trim() ?? "";
    const lastName = refreshed.lastName?.trim() ?? "";

    const profileContext = buildPromptContext(
      summary,
      firstName || "Candidate",
      lastName,
      refreshed.currentTitle,
      refreshed.professionalSummary,
      refreshed.workAuthorization,
      refreshed.salaryExpectation,
      refreshed.availableFrom,
      customQA,
      {
        languages: refreshed.languages,
        certifications: refreshed.certifications,
        highestEducation: refreshed.highestEducation,
        currentCompensation: refreshed.currentCompensation,
        noticePeriod: refreshed.noticePeriod,
        relocationPreference: refreshed.relocationPreference,
        remotePreference: refreshed.remotePreference,
      },
    );

    const structuredProfile = userToStructuredProfile({
      email: refreshed.email,
      firstName: refreshed.firstName,
      lastName: refreshed.lastName,
      phone: refreshed.phone,
      address: refreshed.address,
      city: refreshed.city,
      country: refreshed.country,
      linkedinUrl: refreshed.linkedinUrl,
      githubUrl: refreshed.githubUrl,
      portfolioUrl: refreshed.portfolioUrl,
      workAuthorization: refreshed.workAuthorization,
      salaryExpectation: refreshed.salaryExpectation,
      currentCompensation: refreshed.currentCompensation,
      availableFrom: refreshed.availableFrom,
      noticePeriod: refreshed.noticePeriod,
      yearsOfExperience: refreshed.yearsOfExperience,
      currentTitle: refreshed.currentTitle,
      currentCompany: refreshed.currentCompany,
      professionalSummary: refreshed.professionalSummary,
      languages: refreshed.languages,
      certifications: refreshed.certifications,
      highestEducation: refreshed.highestEducation,
      relocationPreference: refreshed.relocationPreference,
      remotePreference: refreshed.remotePreference,
    });

    const llmInput: Array<{ id: string; question: string; charLimit?: number }> = [];
    const structuredById = new Map<string, string>();
    const sourceById = new Map<string, "structured" | "llm">();

    for (const q of questions) {
      const id = String(q.id);
      const qtext = String(q.question);
      const kind = q.kind === "structured" || q.kind === "free_text" ? q.kind : undefined;
      const resolved = tryStructuredAnswer(qtext, structuredProfile, kind);
      if (resolved != null) {
        structuredById.set(id, resolved);
        sourceById.set(id, "structured");
      } else {
        llmInput.push({ id, question: qtext, charLimit: q.charLimit });
      }
    }

    if (llmInput.length > 0 && !process.env.ANTHROPIC_API_KEY?.trim()) {
      return reply.status(503).send({
        error: "Service unavailable",
        message: "AI answers are not configured",
      });
    }

    const resumeExcerpt = (refreshed.resumeText ?? "").trim().slice(0, 12_000);
    const prefs = prefsFromRow(refreshed.smartApplyPreferences);
    const ov = parsePreferenceOverrides(body.preferenceOverrides);
    const mergedPrefs: SmartApplyPreferencesShape = {
      tone: ov.tone ?? prefs?.tone ?? "professional",
      length: ov.length ?? prefs?.length ?? "medium",
      firstPerson: ov.firstPerson ?? prefs?.firstPerson ?? true,
    };

    let llmAnswers: Array<{ id: string; answer: string }> = [];
    let llmAnswerMeta: Array<{ id: string; source: "llm"; confidence: "high" | "medium" | "low" }> = [];
    let tokensUsed = 0;

    if (llmInput.length > 0) {
      let result;
      try {
        result = await generateApplyAnswers({
          questions: llmInput.map((q) => ({
            id: q.id,
            question: q.question,
            charLimit: q.charLimit,
          })),
          jobTitle,
          companyName,
          profileContext,
          resumeExcerpt,
          preferences: mergedPrefs,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "AI request failed";
        return reply.status(503).send({ error: "Service unavailable", message: msg });
      }
      llmAnswers = result.answers;
      llmAnswerMeta = result.answerMeta ?? [];
      tokensUsed = result.tokensUsed;
      for (const a of llmAnswers) sourceById.set(a.id, "llm");

      if (!canBypassSmartApplyDailyLimit()) {
        await server.prisma.user.update({
          where: { id: ctx.internalUserId },
          data: {
            smartApplyJobsToday: refreshed.smartApplyJobsToday + 1,
            smartApplyResetAt: new Date(),
          },
        });
      }

      server.log.info(
        {
          event: "long_answer_generated_count",
          userId: ctx.internalUserId,
          generatedCount: llmAnswers.length,
          promptCount: llmInput.length,
          tokensUsed,
        },
        "smart_apply_event",
      );
    }

    const byId = new Map<string, string>();
    for (const [id, a] of structuredById) byId.set(id, a);
    for (const a of llmAnswers) byId.set(a.id, a.answer);

    const answers = questions.map((q) => ({
      id: String(q.id),
      answer: byId.get(String(q.id)) ?? "",
    }));

    const effectiveAfter = await resolveProPlan(server.prisma, ctx.internalUserId, ctx.email);
    const newLimits = getPlanLimits(effectiveAfter.plan);
    const lim = newLimits.smartApplyJobs;
    const consumed = llmInput.length > 0 && !canBypassSmartApplyDailyLimit() ? 1 : 0;
    const jobsRemainingToday = Math.max(0, lim - (refreshed.smartApplyJobsToday + consumed));

    const answerMeta = answers.map((a) => {
      const source = sourceById.get(a.id) ?? "llm";
      const llmMeta = llmAnswerMeta.find((m) => m.id === a.id);
      const confidence = source === "structured" ? "high" : (llmMeta?.confidence ?? "medium");
      return { id: a.id, source, confidence };
    });

    return reply.send({
      answers,
      answerMeta,
      tokensUsed,
      jobsRemainingToday,
      jobsLimit: lim,
    });
  });
}
