"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  extractProfileFromResume,
  fetchApplyProfile,
  postSmartApplyEvent,
  fetchSmartApplyStatus,
  patchApplyProfile,
  type ApplyProfileCustomQA,
  type ApplyProfilePatch,
  type ApplyProfileResponse,
  type SmartApplyTone,
} from "../../../lib/api";
import { getPlanLimits, isPro } from "../../../lib/planLimits";
import { useResume } from "../../../lib/resumeContext";
import { ResumeUploadModal } from "../../../components/resume/ResumeUploadModal";
import { HeroPositioning } from "../../../components/smart-apply/HeroPositioning";
import { ProofStrip } from "../../../components/smart-apply/ProofStrip";
import { ReadinessCockpit } from "../../../components/smart-apply/ReadinessCockpit";
import { TrustSafetyBlock } from "../../../components/smart-apply/TrustSafetyBlock";
import { jobloomChromeWebStoreUrl } from "../../../lib/jobloomChromeStore";
import { useExtensionPresence } from "../../../lib/useExtensionPresence";

const CORAL = "#E8533A";
const SMART_APPLY_PREMIUM_V1 = process.env.NEXT_PUBLIC_SMART_APPLY_PREMIUM_V1 !== "false";

const COUNTRIES = [
  "United States",
  "United Kingdom",
  "Canada",
  "India",
  "Australia",
  "Germany",
  "France",
  "Netherlands",
  "Singapore",
  "Other",
] as const;

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function nextUtcMidnight(from = new Date()): Date {
  return new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 0, 0, 0, 0),
  );
}

/** If user already refreshed profile today (UTC), next allowed time is next UTC midnight. */
function profileExtractQuota(lastAtIso: string | null, bypassDailyLimit = false): {
  canImport: boolean;
  nextEligibleAt: Date | null;
} {
  if (bypassDailyLimit) return { canImport: true, nextEligibleAt: null };
  if (!lastAtIso) return { canImport: true, nextEligibleAt: null };
  const last = new Date(lastAtIso);
  const now = new Date();
  if (last >= startOfUtcDay(now)) {
    return { canImport: false, nextEligibleAt: nextUtcMidnight(now) };
  }
  return { canImport: true, nextEligibleAt: null };
}

const DEFAULT_PREFS = {
  tone: "professional" as const,
  length: "medium" as const,
  firstPerson: true,
};

const REMOTE_PREFS = [
  { value: "", label: "Select…" },
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "On-site" },
  { value: "no_preference", label: "No preference" },
] as const;

const AVAIL_NOTICE_CHOICES = [
  { value: "Immediately", label: "Immediately" },
  { value: "2 weeks", label: "In ~2 weeks (after notice)" },
  { value: "1 month", label: "In ~1 month" },
  { value: "3 months", label: "In ~3 months" },
  { value: "Flexible", label: "Flexible / negotiable" },
] as const;

const AVAIL_NOTICE_VALUE_SET = new Set<string>(AVAIL_NOTICE_CHOICES.map((c) => c.value));

type SectionId =
  | "answerBank"
  | "identityContact"
  | "professionalProfile"
  | "skillsEducation"
  | "applicationFields";

const SECTION_ORDER: SectionId[] = [
  "answerBank",
  "identityContact",
  "professionalProfile",
  "skillsEducation",
  "applicationFields",
];

const SECTION_META: Record<SectionId, { title: string; description: string }> = {
  answerBank: {
    title: "Context and Answers",
    description: "Improve long written answer quality with your preferred tone and examples.",
  },
  identityContact: {
    title: "Identity and Contact",
    description: "Core profile identity and public links for applications.",
  },
  professionalProfile: {
    title: "Professional Profile",
    description: "Current role, experience, and personal professional summary.",
  },
  skillsEducation: {
    title: "Skills and Education",
    description: "Resume-derived skills and education. Optional manual edits for better personalization.",
  },
  applicationFields: {
    title: "Application Fields",
    description: "Manual entry required fields commonly asked in forms.",
  },
};

function asExtrasObject(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim();
    if (!key) continue;
    if (v == null) continue;
    const value = typeof v === "string" ? v : String(v);
    if (!value.trim()) continue;
    out[key] = value;
  }
  return out;
}

function extractSummarySkills(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const skills = (raw as Record<string, unknown>).skills;
  if (!Array.isArray(skills)) return [];
  return skills
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .slice(0, 30);
}

function buildForm(p: ApplyProfileResponse | null): ApplyProfilePatch {
  if (!p) {
    return {
      firstName: "",
      lastName: "",
      phone: "",
      address: "",
      city: "",
      country: "",
      linkedinUrl: "",
      githubUrl: "",
      portfolioUrl: "",
      workAuthorization: "",
      salaryExpectation: "",
      currentCompensation: "",
      availableFrom: "",
      noticePeriod: "",
      relocationPreference: "",
      remotePreference: "",
      yearsOfExperience: null,
      currentTitle: "",
      currentCompany: "",
      professionalSummary: "",
      languages: "",
      certifications: "",
      highestEducation: "",
      customQA: [],
      smartApplyPreferences: { ...DEFAULT_PREFS },
      applyProfileExtras: {},
    };
  }
  return {
    firstName: p.firstName ?? "",
    lastName: p.lastName ?? "",
    phone: p.phone ?? "",
    address: p.address ?? "",
    city: p.city ?? "",
    country: p.country ?? "",
    linkedinUrl: p.linkedinUrl ?? "",
    githubUrl: p.githubUrl ?? "",
    portfolioUrl: p.portfolioUrl ?? "",
    workAuthorization: p.workAuthorization ?? "",
    salaryExpectation: p.salaryExpectation ?? "",
    currentCompensation: p.currentCompensation ?? "",
    availableFrom: p.availableFrom ?? "",
    noticePeriod: p.noticePeriod ?? "",
    relocationPreference: p.relocationPreference ?? "",
    remotePreference: p.remotePreference ?? "",
    yearsOfExperience: p.yearsOfExperience,
    currentTitle: p.currentTitle ?? "",
    currentCompany: p.currentCompany ?? "",
    professionalSummary: p.professionalSummary ?? "",
    languages: p.languages ?? "",
    certifications: p.certifications ?? "",
    highestEducation: p.highestEducation ?? "",
    customQA: [...(p.customQA ?? [])],
    smartApplyPreferences: {
      tone: p.smartApplyPreferences?.tone ?? DEFAULT_PREFS.tone,
      length: p.smartApplyPreferences?.length ?? DEFAULT_PREFS.length,
      firstPerson: p.smartApplyPreferences?.firstPerson ?? DEFAULT_PREFS.firstPerson,
    },
    applyProfileExtras: asExtrasObject(p.applyProfileExtras),
  };
}

function availabilityNoticeCombined(
  availableFrom: string | null | undefined,
  noticePeriod: string | null | undefined,
): string {
  const a = (availableFrom ?? "").trim();
  const n = (noticePeriod ?? "").trim();
  if (a && n && a !== n) return `${a}\n${n}`;
  return n || a;
}

export default function SmartApplyPage() {
  const { getToken, isSignedIn, isLoaded: authLoaded } = useAuth();
  const { hasResume, fileName, resumeUpdatedAt, refreshStatus } = useResume();
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [form, setForm] = useState<ApplyProfilePatch>(() => buildForm(null));
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractMessage, setExtractMessage] = useState<string | null>(null);
  const [profileExtractLastAt, setProfileExtractLastAt] = useState<string | null>(null);
  const [extractDailyLimitBypassed, setExtractDailyLimitBypassed] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("answerBank");
  const [resumeSkills, setResumeSkills] = useState<string[]>([]);
  const [status, setStatus] = useState<Awaited<
    ReturnType<typeof fetchSmartApplyStatus>
  > | null>(null);

  const load = useCallback(async () => {
    const token = await getToken({ skipCache: true });
    if (!token) return;
    setLoadError(null);
    try {
      const [profile, st] = await Promise.all([
        fetchApplyProfile(token),
        fetchSmartApplyStatus(token),
      ]);
      if (profile) {
        setForm(buildForm(profile));
        setProfileExtractLastAt(profile.profileExtractLastAt);
        setExtractDailyLimitBypassed(profile.extractDailyLimitBypassed === true);
        setResumeSkills(extractSummarySkills(profile.applyProfileSummary));
      }
      setStatus(st);
    } catch {
      setLoadError("Could not load profile.");
    }
  }, [getToken]);

  useEffect(() => {
    if (!authLoaded || !isSignedIn) return;
    void load();
  }, [authLoaded, isSignedIn, load]);

  const patch = useCallback(
    async (body: ApplyProfilePatch) => {
      const token = await getToken({ skipCache: true });
      if (!token) return false;
      setSaveState("saving");
      try {
        const next = await patchApplyProfile(token, body);
        setForm(buildForm(next));
        setProfileExtractLastAt(next.profileExtractLastAt);
        setExtractDailyLimitBypassed(next.extractDailyLimitBypassed === true);
        setSaveState("saved");
        void fetchSmartApplyStatus(token).then(setStatus);
        window.setTimeout(() => setSaveState("idle"), 2000);
        return true;
      } catch {
        setSaveState("idle");
        return false;
      }
    },
    [getToken],
  );

  const updateField = useCallback(<K extends keyof ApplyProfilePatch>(key: K, val: ApplyProfilePatch[K]) => {
    setForm((f) => ({ ...f, [key]: val }));
  }, []);

  const updatePreference = useCallback(
    (key: "tone" | "length" | "firstPerson", val: string | boolean) => {
      setForm((f) => ({
        ...f,
        smartApplyPreferences: {
          tone: f.smartApplyPreferences?.tone ?? DEFAULT_PREFS.tone,
          length: f.smartApplyPreferences?.length ?? DEFAULT_PREFS.length,
          firstPerson: f.smartApplyPreferences?.firstPerson ?? DEFAULT_PREFS.firstPerson,
          [key]: val,
        },
      }));
    },
    [],
  );

  const setTone = useCallback(
    (tone: SmartApplyTone) => updatePreference("tone", tone),
    [updatePreference],
  );

  const handleExtractProfile = useCallback(async () => {
    const token = await getToken({ skipCache: true });
    if (!token) return;
    setExtractMessage(null);
    setExtractLoading(true);
    try {
      await extractProfileFromResume(token);
      setExtractMessage("Profile updated from resume.");
      await load();
      await refreshStatus();
    } catch (e) {
      setExtractMessage(e instanceof Error ? e.message : "Could not import profile");
    } finally {
      setExtractLoading(false);
    }
  }, [getToken, load, refreshStatus]);

  const extractQuota = profileExtractQuota(profileExtractLastAt, extractDailyLimitBypassed);
  const completionPct = status?.profileCompletionPct ?? 0;

  const plan = status?.plan ?? "free";
  const isPaid = isPro(plan);
  const planLabel = isPaid ? "Pro" : null;
  const limits = getPlanLimits(plan);
  const jobsToday = status?.jobsToday ?? 0;
  const jobsLimit = status?.jobsLimit ?? limits.smartApplyJobs;
  const jobsRemaining = status?.jobsRemaining ?? null;
  const extensionConnected = useExtensionPresence();
  const pctUsed =
    jobsLimit > 0 ? Math.min(100, Math.round((jobsToday / jobsLimit) * 100)) : 0;

  const availNoticeStored = availabilityNoticeCombined(form.availableFrom, form.noticePeriod).trim();
  const availNoticeIsPreset = !availNoticeStored || AVAIL_NOTICE_VALUE_SET.has(availNoticeStored);
  const availNoticeCustomLabel =
    availNoticeStored.length > 72 ? `${availNoticeStored.slice(0, 69)}…` : availNoticeStored;

  const handleSaveClick = async (continueNext = false) => {
    const ok = await patch(form);
    if (ok) {
      try {
        if (
          typeof window !== "undefined" &&
          !window.sessionStorage.getItem("jl_meta_smart_apply_profile_save")
        ) {
          window.sessionStorage.setItem("jl_meta_smart_apply_profile_save", "1");
          const { trackSmartApplyProfileSaveOnce } = await import("../../../lib/analytics/events");
          void trackSmartApplyProfileSaveOnce({ getToken: () => getToken() });
        }
      } catch {
        /* non-blocking */
      }
    }
    if (!ok || !continueNext) return;
    const idx = SECTION_ORDER.indexOf(activeSection);
    if (idx >= 0 && idx < SECTION_ORDER.length - 1) {
      setActiveSection(SECTION_ORDER[idx + 1]!);
    }
  };

  const hasValue = (v: unknown): boolean => {
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v === "boolean") return true;
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    return String(v).trim().length > 0;
  };

  const sectionCompletion = (id: SectionId): { filled: number; total: number } => {
    switch (id) {
      case "answerBank": {
        const fields = [
          form.smartApplyPreferences?.tone,
          form.smartApplyPreferences?.length,
          form.customQA?.length ? "qa" : "",
        ];
        return { filled: fields.filter(hasValue).length, total: fields.length };
      }
      case "identityContact": {
        const fields = [
          form.firstName,
          form.lastName,
          form.phone,
          form.address,
          form.city,
          form.country,
          form.linkedinUrl,
          form.githubUrl,
          form.portfolioUrl,
        ];
        return { filled: fields.filter(hasValue).length, total: fields.length };
      }
      case "professionalProfile": {
        const fields = [form.currentTitle, form.currentCompany, form.yearsOfExperience, form.professionalSummary];
        return { filled: fields.filter(hasValue).length, total: fields.length };
      }
      case "skillsEducation": {
        const fields = [form.languages, form.certifications, form.highestEducation];
        return { filled: fields.filter(hasValue).length, total: fields.length };
      }
      case "applicationFields": {
        const extraCount = Object.keys(asExtrasObject(form.applyProfileExtras)).length;
        const availNotice =
          [form.availableFrom, form.noticePeriod].some((x) => String(x ?? "").trim().length > 0)
            ? "avail"
            : "";
        const fields = [
          form.salaryExpectation,
          form.currentCompensation,
          availNotice,
          form.remotePreference,
          extraCount > 0 ? "extras" : "",
        ];
        return { filled: fields.filter(hasValue).length, total: fields.length };
      }
    }
  };

  const addQA = () => {
    setForm((f) => ({
      ...f,
      customQA: [...(f.customQA ?? []), { question: "", answer: "" }],
    }));
  };

  const removeQA = (idx: number) => {
    setForm((f) => ({
      ...f,
      customQA: (f.customQA ?? []).filter((_, i) => i !== idx),
    }));
  };

  const updateQA = (idx: number, field: "question" | "answer", val: string) => {
    setForm((f) => {
      const qa = [...(f.customQA ?? [])];
      const row = qa[idx];
      if (!row) return f;
      qa[idx] = { ...row, [field]: val };
      return { ...f, customQA: qa };
    });
  };

  const extrasObj = asExtrasObject(form.applyProfileExtras);
  const skillsText = extrasObj.skills ?? "";
  const applyExtraPairs = Object.entries(extrasObj).filter(([k]) => k !== "skills");

  const updateExtra = (key: string, value: string) => {
    setForm((f) => {
      const extras = { ...asExtrasObject(f.applyProfileExtras) };
      const nextKey = key.trim();
      if (!nextKey) return { ...f, applyProfileExtras: extras };
      if (value.trim()) {
        extras[nextKey] = value;
      } else {
        delete extras[nextKey];
      }
      return { ...f, applyProfileExtras: extras };
    });
  };

  const renameExtraKey = (oldKey: string, newKey: string) => {
    setForm((f) => {
      const extras = { ...asExtrasObject(f.applyProfileExtras) };
      const trimmed = newKey.trim();
      const val = extras[oldKey] ?? "";
      delete extras[oldKey];
      if (trimmed) extras[trimmed] = val;
      return { ...f, applyProfileExtras: extras };
    });
  };

  const addExtraField = () => {
    setForm((f) => {
      const extras = { ...asExtrasObject(f.applyProfileExtras) };
      let i = 1;
      let k = `customField${i}`;
      while (extras[k]) {
        i += 1;
        k = `customField${i}`;
      }
      extras[k] = "";
      return { ...f, applyProfileExtras: extras };
    });
  };

  if (!authLoaded) {
    return (
      <div className="mx-auto w-[90%] max-w-jobs px-4 py-16 text-sm text-ink-muted">
        Loading…
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="mx-auto w-[90%] max-w-jobs px-4 py-16">
        <h1 className="font-sans text-2xl font-bold text-ink">Smart Apply</h1>
        <p className="mt-2 text-ink-muted">Sign in to set up your apply profile.</p>
        <SignInButton mode="modal" forceRedirectUrl="/smart-apply">
          <button
            type="button"
            className="mt-4 rounded-xl px-5 py-2.5 text-sm font-bold text-white"
            style={{ backgroundColor: CORAL }}
          >
            Sign in →
          </button>
        </SignInButton>
      </div>
    );
  }

  const activeMeta = SECTION_META[activeSection];
  const activeStats = sectionCompletion(activeSection);

  return (
    <div className="mx-auto w-[92%] max-w-[1380px] px-4 py-10">
      <HeroPositioning isPaid={isPaid} planLabel={planLabel} completionPct={completionPct} />
      {SMART_APPLY_PREMIUM_V1 ? (
        <>
          <ProofStrip
            applicationsAssisted={jobsToday}
            jobsLimit={jobsLimit}
            profileCompletionPct={completionPct}
            setupMinutes={2}
          />
          <ReadinessCockpit
            hasResume={hasResume}
            profileCompletionPct={completionPct}
            extensionConnected={extensionConnected}
            jobsRemaining={jobsRemaining}
            resetsAt={status?.resetsAt ?? null}
          />
        </>
      ) : null}

      {loadError ? (
        <p className="mb-4 text-sm text-red-600" role="alert">
          {loadError}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <section className="rounded-2xl border border-line bg-surface p-4 shadow-card ring-1 ring-ink/5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink/50">Resume</h2>
            {!hasResume ? (
              <div className="mt-2 text-sm text-ink-muted">
                <p>No resume uploaded (required to use Smart Apply).</p>
                <button
                  type="button"
                  onClick={() => setResumeModalOpen(true)}
                  className="mt-2 rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold hover:border-brand/40 hover:text-brand"
                >
                  Upload resume
                </button>
              </div>
            ) : (
              <div className="mt-2 text-sm">
                <p className="truncate font-semibold text-ink" title={fileName ?? "Resume"}>
                  {fileName ?? "Resume"}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  {resumeUpdatedAt ? `Updated ${new Date(resumeUpdatedAt).toLocaleDateString()}` : null}
                </p>
                <button
                  type="button"
                  onClick={() => setResumeModalOpen(true)}
                  className="mt-2 rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold hover:border-brand/40 hover:text-brand"
                >
                  Replace resume
                </button>
                <button
                  type="button"
                  disabled={extractLoading || (!extractDailyLimitBypassed && !extractQuota.canImport)}
                  onClick={() => void handleExtractProfile()}
                  className="mt-2 block rounded-lg border border-brand/40 bg-brand/5 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10 disabled:opacity-50"
                >
                  {extractLoading ? "Importing..." : "Import profile from resume"}
                </button>
                {extractMessage ? <p className="mt-1 text-xs text-ink-muted">{extractMessage}</p> : null}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-surface p-4 shadow-card ring-1 ring-ink/5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink/50">Usage</h2>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink/10">
              <div className="h-full rounded-full bg-brand" style={{ width: `${pctUsed}%` }} />
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              {jobsToday}/{jobsLimit} used today
            </p>
            {!isPaid ? (
              <Link href="/pricing?from=smart_apply" className="mt-2 inline-block text-xs font-semibold text-brand hover:underline">
                Upgrade plan
              </Link>
            ) : null}
          </section>

          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card ring-1 ring-ink/5">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-ink/50">Sections</p>
            <div className="space-y-2">
              {SECTION_ORDER.map((id, idx) => {
                const meta = SECTION_META[id];
                const stats = sectionCompletion(id);
                const active = id === activeSection;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveSection(id)}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                      active
                        ? "border-brand/50 bg-brand/5"
                        : "border-line bg-white hover:border-brand/30 hover:bg-brand/5"
                    }`}
                  >
                    <div className="text-xs font-semibold text-ink">{idx + 1}. {meta.title}</div>
                    <div className="mt-0.5 text-[11px] text-ink/55">
                      {stats.filled}/{stats.total} complete
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <main className="space-y-4">
          <section className="rounded-2xl border border-line bg-surface p-4 shadow-card ring-1 ring-ink/5">
            <h2 className="text-sm font-bold text-ink">Browser extension</h2>
            <p className="mt-1 text-xs text-ink-muted">
              Required: install the Chrome extension to use Smart Apply on ATS forms.
            </p>
            <a
              href={jobloomChromeWebStoreUrl()}
              target="_blank"
              rel="noopener noreferrer"
              onClick={async () => {
                const token = await getToken({ skipCache: true });
                if (!token) return;
                await postSmartApplyEvent(token, "extension_installed_clicked", {
                  source: "smart_apply_page",
                });
              }}
              className="mt-3 inline-flex rounded-lg px-3 py-2 text-xs font-bold text-white no-underline"
              style={{ backgroundColor: CORAL }}
            >
              Install extension
            </a>
          </section>

          <section className="rounded-2xl border border-line bg-surface p-4 shadow-card ring-1 ring-ink/5">
            <h2 className="text-sm font-bold text-ink">How to use Smart Apply</h2>
            <ol className="mt-2 list-decimal space-y-2 pl-4 text-xs text-ink-muted">
              <li>
                Upload a resume (required), then use <strong className="font-semibold text-ink">import from resume</strong>{" "}
                so your profile matches your CV—Smart Apply uses that as the main source for answers.
              </li>
              <li>
                Use the rest of this page as optional context: add detail if you want answers to match your voice and
                priorities.
              </li>
              <li>
                Install the Chrome extension (section above). Use JobLoom only in{" "}
                <strong className="font-semibold text-ink">this same Chrome profile</strong>—the extension reads the
                account you use on jobloom.tech, not a different browser or profile.
              </li>
              <li>
                <strong className="font-semibold text-ink">Sync your session:</strong> after you install the extension or
                change JobLoom accounts, open any signed-in JobLoom tab (this page works) and focus it for a few seconds.
                That pushes your current login to the extension. If Smart Apply on an employer site cannot load your plan
                or profile, come back here while signed in, focus this tab again, then retry the extension.
              </li>
              <li>
                From JobLoom job listings, click <strong className="font-semibold text-ink">Apply</strong> to open the
                employer&apos;s application in a new tab—common ATS pages are supported.
              </li>
              <li>
                On the application page, open the extension and run field detection and autofill using the profile you
                saved here.
              </li>
              <li>
                Review generated long answers and every autofilled field; edit where needed, then submit yourself—you
                stay in control.
              </li>
            </ol>
          </section>

          <section className="rounded-2xl border border-line bg-surface p-6 shadow-card ring-1 ring-ink/5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-ink">{activeMeta.title}</h2>
                <p className="mt-1 text-sm text-ink-muted">{activeMeta.description}</p>
              </div>
              <span className="rounded-full bg-ink/5 px-3 py-1 text-xs text-ink-muted">
                {activeStats.filled}/{activeStats.total}
              </span>
            </div>

            {activeSection === "answerBank" ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-medium text-ink/70">
                    Tone
                    <select
                      value={form.smartApplyPreferences?.tone ?? "professional"}
                      onChange={(e) => setTone(e.target.value as SmartApplyTone)}
                      className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                    >
                      <option value="professional">Professional</option>
                      <option value="friendly">Friendly</option>
                      <option value="formal">Formal</option>
                      <option value="casual">Casual</option>
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-ink/70">
                    Length
                    <select
                      value={form.smartApplyPreferences?.length ?? "medium"}
                      onChange={(e) => updatePreference("length", e.target.value)}
                      className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                    >
                      <option value="short">Short</option>
                      <option value="medium">Medium</option>
                      <option value="long">Long</option>
                    </select>
                  </label>
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-ink/70">
                  <input
                    type="checkbox"
                    checked={form.smartApplyPreferences?.firstPerson !== false}
                    onChange={(e) => updatePreference("firstPerson", e.target.checked)}
                    className="rounded border-line"
                  />
                  First person (I / my)
                </label>
                <p className="text-xs text-ink-muted">
                  Optional: add examples of your best long written answers so Smart Apply can align tone and narrative style.
                </p>
                {(form.customQA ?? []).map((row: ApplyProfileCustomQA, idx: number) => (
                  <div key={idx} className="rounded-xl border border-line bg-canvas/50 p-3">
                    <label className="block text-xs font-medium text-ink/70">
                      Prompt
                      <input
                        value={row.question}
                        onChange={(e) => updateQA(idx, "question", e.target.value)}
                        placeholder="Example: Why do you want to work here?"
                        className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="mt-2 block text-xs font-medium text-ink/70">
                      Answer
                      <textarea
                        value={row.answer}
                        onChange={(e) => updateQA(idx, "answer", e.target.value)}
                        rows={3}
                        placeholder="Example: I love product-focused teams and enjoy building reliable systems end-to-end."
                        className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                      />
                    </label>
                    <button type="button" onClick={() => removeQA(idx)} className="mt-2 text-xs text-red-700 hover:underline">
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addQA}
                  className="rounded-lg border border-dashed border-brand/40 px-3 py-2 text-sm font-semibold text-brand hover:bg-brand/5"
                >
                  + Add AI answer context (with example)
                </button>
              </div>
            ) : null}

            {activeSection === "identityContact" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-ink/70">First name<input value={form.firstName ?? ""} onChange={(e) => updateField("firstName", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
                <label className="block text-xs font-medium text-ink/70">Last name<input value={form.lastName ?? ""} onChange={(e) => updateField("lastName", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
                <label className="block text-xs font-medium text-ink/70">Phone<input value={form.phone ?? ""} onChange={(e) => updateField("phone", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
                <label className="block text-xs font-medium text-ink/70">City<input value={form.city ?? ""} onChange={(e) => updateField("city", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
                <label className="block text-xs font-medium text-ink/70 sm:col-span-2">Address<input value={form.address ?? ""} onChange={(e) => updateField("address", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
                <label className="block text-xs font-medium text-ink/70 sm:col-span-2">Country<select value={form.country ?? ""} onChange={(e) => updateField("country", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"><option value="">Select...</option>{COUNTRIES.map((c) => (<option key={c} value={c}>{c}</option>))}</select></label>
                <label className="block text-xs font-medium text-ink/70 sm:col-span-2">LinkedIn<input value={form.linkedinUrl ?? ""} onChange={(e) => updateField("linkedinUrl", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
                <label className="block text-xs font-medium text-ink/70">GitHub<input value={form.githubUrl ?? ""} onChange={(e) => updateField("githubUrl", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
                <label className="block text-xs font-medium text-ink/70">Portfolio<input value={form.portfolioUrl ?? ""} onChange={(e) => updateField("portfolioUrl", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
              </div>
            ) : null}

            {activeSection === "professionalProfile" ? (
              <div className="space-y-4">
                <label className="block text-xs font-medium text-ink/70">Current job title<input value={form.currentTitle ?? ""} onChange={(e) => updateField("currentTitle", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
                <label className="block text-xs font-medium text-ink/70">Current company<input value={form.currentCompany ?? ""} onChange={(e) => updateField("currentCompany", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
                <label className="block text-xs font-medium text-ink/70">Years of experience<input type="number" min={0} max={80} value={form.yearsOfExperience ?? ""} onChange={(e) => updateField("yearsOfExperience", e.target.value === "" ? null : Number(e.target.value))} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
                <label className="block text-xs font-medium text-ink/70">Professional summary<textarea value={form.professionalSummary ?? ""} onChange={(e) => updateField("professionalSummary", e.target.value)} rows={6} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
              </div>
            ) : null}

            {activeSection === "skillsEducation" ? (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-ink/70">Extracted skills from resume</p>
                  {resumeSkills.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {resumeSkills.map((skill) => (
                        <span
                          key={skill}
                          className="rounded-full border border-brand/25 bg-brand/5 px-2 py-1 text-[11px] font-medium text-brand"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-ink-muted">
                      No resume skills extracted yet. Upload/refresh resume to populate this list.
                    </p>
                  )}
                </div>
                <label className="block text-xs font-medium text-ink/70">
                  Skills (manual)
                  <input
                    value={skillsText}
                    onChange={(e) => updateExtra("skills", e.target.value)}
                    placeholder="e.g. TypeScript, Node.js, Fastify, PostgreSQL"
                    className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs font-medium text-ink/70">Languages<input value={form.languages ?? ""} onChange={(e) => updateField("languages", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
                <label className="block text-xs font-medium text-ink/70">Certifications<input value={form.certifications ?? ""} onChange={(e) => updateField("certifications", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
                <label className="block text-xs font-medium text-ink/70">Highest education<input value={form.highestEducation ?? ""} onChange={(e) => updateField("highestEducation", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
              </div>
            ) : null}

            {activeSection === "applicationFields" ? (
              <div className="space-y-4">
                <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                  Manual Entry Required: these fields are usually not reliably available from resume extraction.
                </p>
                <label className="block text-xs font-medium text-ink/70">Expected compensation<input value={form.salaryExpectation ?? ""} onChange={(e) => updateField("salaryExpectation", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
                <label className="block text-xs font-medium text-ink/70">Current compensation<input value={form.currentCompensation ?? ""} onChange={(e) => updateField("currentCompensation", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
                <label className="block text-xs font-medium text-ink/70">
                  Available from / notice period
                  <select
                    value={availNoticeStored}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, availableFrom: "", noticePeriod: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                  >
                    <option value="">Select…</option>
                    {!availNoticeIsPreset ? (
                      <option value={availNoticeStored}>{`Current: ${availNoticeCustomLabel}`}</option>
                    ) : null}
                    {AVAIL_NOTICE_CHOICES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-ink/70">Remote preference<select value={form.remotePreference ?? ""} onChange={(e) => updateField("remotePreference", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm">{REMOTE_PREFS.map((o) => (<option key={o.value || "empty"} value={o.value}>{o.label}</option>))}</select></label>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-ink/70">Additional application fields</h3>
                    <button type="button" onClick={addExtraField} className="text-xs font-semibold text-brand hover:underline">+ Add field</button>
                  </div>
                  {applyExtraPairs.map(([k, v]) => (
                    <div key={k} className="grid gap-2 sm:grid-cols-2">
                      <input value={k} onChange={(e) => renameExtraKey(k, e.target.value)} className="rounded-lg border border-line px-3 py-2 text-sm" />
                      <input value={v} onChange={(e) => updateExtra(k, e.target.value)} className="rounded-lg border border-line px-3 py-2 text-sm" />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="mr-2 text-xs text-ink-muted">
              {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved ✓" : ""}
            </span>
            <button
              type="button"
              onClick={() => void handleSaveClick(false)}
              className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink"
            >
              Save section
            </button>
            <button
              type="button"
              onClick={() => void handleSaveClick(true)}
              className="rounded-lg px-3 py-2 text-xs font-bold text-white"
              style={{ backgroundColor: CORAL }}
            >
              Save and next section
            </button>
          </div>
          {SMART_APPLY_PREMIUM_V1 ? <TrustSafetyBlock /> : null}
        </main>
      </div>

      <ResumeUploadModal
        open={resumeModalOpen}
        onClose={() => {
          setResumeModalOpen(false);
          void refreshStatus().then(() => load());
        }}
      />
    </div>
  );
}
