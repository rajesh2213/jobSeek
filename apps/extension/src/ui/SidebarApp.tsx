import { useEffect, useState } from "react";
import type { ApplyProfile } from "../lib/formFiller";
import {
  fetchApplyProfileDetailed,
  fetchResumeFile,
  fetchSmartApplyStatusDetailed,
} from "../lib/api";
import { batchAnswer } from "../lib/api";
import { highlightField } from "../lib/autofill/highlight";
import { FloatingTrigger } from "./FloatingTrigger";
import { Sidebar } from "./Sidebar";
import {
  getSidebarState,
  patchSidebarState,
  pickDetectedFieldLabel,
  resetFieldStates,
  setDetectedFields,
  subscribeSidebarState,
  updateFieldState,
  type FieldState,
} from "./store";
import { shouldShowGenerateWithAiButton } from "./fieldGenerateAi";
import type { DetectedField } from "../lib/fieldDetector";
import { scanAllPageFields } from "../lib/scanPageFields";
import { SIDEBAR_PANEL_WIDTH_PX, SIDEBAR_TRANSITION } from "./uiMotion";
import { isProductionExtensionBuild } from "../config";

function sendRuntime<T>(msg: object): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(res as T);
    });
  });
}

function mapProfile(raw: Record<string, unknown> | null): ApplyProfile | null {
  if (!raw) return null;
  const extras =
    raw.applyProfileExtras && typeof raw.applyProfileExtras === "object"
      ? (raw.applyProfileExtras as Record<string, unknown>)
      : {};
  return {
    fullName:
      typeof raw.fullName === "string"
        ? raw.fullName
        : [
            typeof raw.firstName === "string" ? raw.firstName : "",
            typeof raw.lastName === "string" ? raw.lastName : "",
          ]
            .filter(Boolean)
            .join(" ")
            .trim() || undefined,
    firstName: typeof raw.firstName === "string" ? raw.firstName : undefined,
    lastName: typeof raw.lastName === "string" ? raw.lastName : undefined,
    email: typeof raw.email === "string" ? raw.email : undefined,
    phone: typeof raw.phone === "string" ? raw.phone : undefined,
    address: typeof raw.address === "string" ? raw.address : undefined,
    city: typeof raw.city === "string" ? raw.city : undefined,
    country: typeof raw.country === "string" ? raw.country : undefined,
    linkedinUrl: typeof raw.linkedinUrl === "string" ? raw.linkedinUrl : undefined,
    githubUrl: typeof raw.githubUrl === "string" ? raw.githubUrl : undefined,
    portfolioUrl: typeof raw.portfolioUrl === "string" ? raw.portfolioUrl : undefined,
    currentTitle: typeof raw.currentTitle === "string" ? raw.currentTitle : undefined,
    currentCompany: typeof raw.currentCompany === "string" ? raw.currentCompany : undefined,
    yearsOfExperience:
      typeof raw.yearsOfExperience === "number" ? raw.yearsOfExperience : undefined,
    workAuthorization:
      typeof raw.workAuthorization === "string" ? raw.workAuthorization : undefined,
    salaryExpectation:
      typeof raw.salaryExpectation === "string" ? raw.salaryExpectation : undefined,
    availableFrom: typeof raw.availableFrom === "string" ? raw.availableFrom : undefined,
    noticePeriod: typeof raw.noticePeriod === "string" ? raw.noticePeriod : undefined,
    pronouns: typeof extras.pronouns === "string" ? extras.pronouns : undefined,
    hearAbout: typeof extras.hearAbout === "string" ? extras.hearAbout : undefined,
    hasResume: typeof raw.hasResume === "boolean" ? raw.hasResume : undefined,
  };
}

function buildAccountSyncHint(
  p: Awaited<ReturnType<typeof fetchApplyProfileDetailed>>,
  s: Awaited<ReturnType<typeof fetchSmartApplyStatusDetailed>>,
): string | null {
  const profileOk = Boolean(p.ok && p.profile);
  const statusOk = Boolean(s.ok && s.snapshot);
  if (profileOk && statusOk) return null;

  const prod = isProductionExtensionBuild();

  if (p.status === 401 || s.status === 401) {
    if (prod) {
      if (p.error === "Not authenticated" || s.error === "Not authenticated") {
        return "Sign in to JobLoom in your browser, then refresh this page.";
      }
      return "Your JobLoom session could not be verified. Sign out and sign back in on JobLoom, then refresh this page.";
    }
    if (p.error === "Not authenticated" || s.error === "Not authenticated") {
      return "HTTP 401 — the extension proxy had no auth token (storage race or cleared). Open a JobLoom tab while signed in so the site can push a fresh token to the extension, then reload this side panel.";
    }
    const apiLine =
      (typeof p.authHint === "string" && p.authHint.trim()) ||
      (typeof s.authHint === "string" && s.authHint.trim()) ||
      "";
    const code =
      (typeof p.authFailureCode === "string" && p.authFailureCode) ||
      (typeof s.authFailureCode === "string" && s.authFailureCode) ||
      "";
    const base =
      "HTTP 401 Unauthorized — Clerk rejected the JWT. Set CLERK_SECRET_KEY or CLERK_JWT_KEY in repo .env (same Clerk project as Next.js), restart npm run dev:server, use a single canonical site host in NEXT_PUBLIC_SITE_URL (do not mix loopback hostnames), then reload this extension.";
    const apiBaseHint =
      !apiLine && !code
        ? " For local API: rebuild the extension with dev webpack so apiBase defaults to your machine, or set chrome.storage.local.apiBase to your dev server URL; clear a stale hosted value if needed."
        : "";
    if (!apiLine && !code) return `${base}${apiBaseHint}`;
    return `API diagnostics${code ? ` (${code})` : ""}${apiLine ? `: ${apiLine}` : ""}\n\n${base}`;
  }

  const parts: string[] = [];
  if (!profileOk) {
    if (prod) {
      if (p.status === 404) {
        parts.push("Open JobLoom once while signed in to finish account setup.");
      } else if (p.status === 0) {
        parts.push("Could not reach JobLoom. Check your connection and try again.");
      } else {
        parts.push("Could not load your JobLoom profile. Try again shortly.");
      }
    } else if (p.status === 404) {
      parts.push(
        "GET /account/apply-profile returned 404 — open the JobLoom site signed in once so the user row exists.",
      );
    } else if (p.status === 0) {
      parts.push(
        `GET /account/apply-profile failed: ${p.error ?? "network error"}. Confirm apiBase matches apps/server PORT.`,
      );
    } else {
      parts.push(`GET /account/apply-profile → HTTP ${p.status}${p.error ? ` (${p.error})` : ""}`);
    }
  }
  if (!statusOk) {
    if (prod) {
      if (s.status === 0) {
        parts.push("Could not refresh Smart Apply status. Check your connection.");
      } else if (s.status !== 401) {
        parts.push("Could not refresh Smart Apply status. Try again.");
      }
    } else if (s.status === 0) {
      parts.push(`GET /account/smart-apply/status failed: ${s.error ?? "network error"}.`);
    } else if (s.status !== 401) {
      parts.push(`GET /account/smart-apply/status → HTTP ${s.status}${s.error ? ` (${s.error})` : ""}`);
    }
  }
  return parts.join(" ");
}

async function loadAccountSnapshotIntoSidebar(): Promise<void> {
  const [pd, resumeFile, sd] = await Promise.all([
    fetchApplyProfileDetailed(),
    fetchResumeFile(),
    fetchSmartApplyStatusDetailed(),
  ]);
  patchSidebarState({
    profile: mapProfile(pd.profile),
    resumeFile,
    smartApplyStatus: sd.snapshot,
    accountDataLoaded: true,
    accountSyncHint: buildAccountSyncHint(pd, sd),
  });
}

export function SidebarApp(props: { isAtsPage: boolean }) {
  const [state, setState] = useState(getSidebarState());

  useEffect(() => {
    return subscribeSidebarState(() => setState({ ...getSidebarState() }));
  }, []);

  /** Keep sidebar in sync when the user signs in from the popup or another tab. */
  useEffect(() => {
    const syncAuth = () => {
      chrome.storage.local.get(["authToken"], (r) => {
        patchSidebarState({ hasAuthToken: Boolean(r.authToken as string | undefined) });
      });
    };
    syncAuth();
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ) => {
      if (area !== "local" || changes.authToken === undefined) return;
      syncAuth();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  useEffect(() => {
    patchSidebarState({ atsDetected: props.isAtsPage, isVisible: props.isAtsPage });
    if (!props.isAtsPage) return;
    const refresh = async () => {
      try {
        const fields = await scanAllPageFields(sendRuntime);
        setDetectedFields(fields);
      } catch {
        // ignore
      }
      await loadAccountSnapshotIntoSidebar();
    };
    void refresh();
    const observer = new MutationObserver(() => {
      window.clearTimeout((window as Window & { __jobseekRescanTimer?: number }).__jobseekRescanTimer);
      (window as Window & { __jobseekRescanTimer?: number }).__jobseekRescanTimer = window.setTimeout(() => {
        if (getSidebarState().isRunning) return;
        void (async () => {
          try {
            const fields = await scanAllPageFields(sendRuntime);
            setDetectedFields(fields);
          } catch {
            // ignore
          }
        })();
      }, 350);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [props.isAtsPage]);

  /** Re-fetch profile and usage when the panel opens so values update after signing in elsewhere. */
  useEffect(() => {
    if (!state.atsDetected || !state.isOpen) return;
    let cancelled = false;
    void (async () => {
      const [pd, resumeFile, sd] = await Promise.all([
        fetchApplyProfileDetailed(),
        fetchResumeFile(),
        fetchSmartApplyStatusDetailed(),
      ]);
      if (cancelled) return;
      patchSidebarState({
        profile: mapProfile(pd.profile),
        resumeFile,
        smartApplyStatus: sd.snapshot,
        accountDataLoaded: true,
        accountSyncHint: buildAccountSyncHint(pd, sd),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [state.isOpen, state.atsDetected]);

  useEffect(() => {
    if (!state.atsDetected) return;
    const html = document.documentElement;
    const prevPaddingRight = html.style.paddingRight;
    const prevOverflowX = html.style.overflowX;
    const prevTransition = html.style.transition;

    html.style.transition = `padding-right ${SIDEBAR_TRANSITION}`;
    if (state.isOpen) {
      html.style.paddingRight = `${SIDEBAR_PANEL_WIDTH_PX}px`;
      html.style.overflowX = "hidden";
    } else {
      html.style.paddingRight = "";
      html.style.overflowX = "";
    }

    return () => {
      html.style.transition = prevTransition;
      html.style.paddingRight = prevPaddingRight;
      html.style.overflowX = prevOverflowX;
    };
  }, [state.isOpen, state.atsDetected]);

  if (!state.isVisible || !state.atsDetected) return null;

  const rescanFields = async () => {
    const fields = await scanAllPageFields(sendRuntime);
    setDetectedFields(fields);
    return fields;
  };

  const runAutofill = async () => {
    let current = getSidebarState();
    if (current.isRunning) return;
    if (!current.profile) {
      try {
        await loadAccountSnapshotIntoSidebar();
      } catch (error) {
        patchSidebarState({
          error: error instanceof Error ? error.message : "Could not load Smart Apply profile",
        });
        return;
      }
      current = getSidebarState();
      if (!current.profile) {
        patchSidebarState({
          error:
            current.accountSyncHint ??
            "Set up your Smart Apply profile before autofill.",
        });
        return;
      }
    }
    if (!current.resumeFile) {
      try {
        await loadAccountSnapshotIntoSidebar();
      } catch (error) {
        patchSidebarState({
          error: error instanceof Error ? error.message : "Could not load resume file",
        });
        return;
      }
      current = getSidebarState();
      if (!current.resumeFile) {
        const noBytesHint =
          current.profile?.hasResume === true
            ? "Smart Apply shows a resume, but the original PDF is not available to download (profile may be text-only). Re-upload your PDF on the JobLoom Smart Apply page, then try again."
            : "Resume file is unavailable. Re-upload resume in JobLoom and try again.";
        patchSidebarState({ error: noBytesHint });
        return;
      }
    }
    current = getSidebarState();
    const saPre = current.smartApplyStatus;
    if (saPre && saPre.profileComplete === false) {
      patchSidebarState({ error: "Complete your profile in JobLoom first (Smart Apply page)." });
      return;
    }
    if (saPre && typeof saPre.jobsRemaining === "number" && saPre.jobsRemaining <= 0) {
      patchSidebarState({
        error: `Daily Smart Apply limit reached. Resets at ${saPre.resetsAt ?? ""}`,
      });
      return;
    }
    await rescanFields();
    const total = getSidebarState().detectedFields.length;
    if (!total) {
      patchSidebarState({ error: "No fillable application fields detected on this page." });
      return;
    }
    resetFieldStates();
    patchSidebarState({
      isOpen: true,
      isRunning: true,
      error: null,
      progress: { completed: 0, total },
    });
    const jobTitle = document.title.split(/[-|·]/)[0]?.trim() || "Role";
    const companyName = document.title.split(/[-|]/).pop()?.trim() || "Company";
    try {
      const fillRes = await sendRuntime<{
        success?: boolean;
        fieldResults?: Array<{ id: string; status: string; reason?: string; source?: string }>;
        openEnded?: DetectedField[];
        error?: string;
      }>({
        type: "FILL_TAB_STANDARD",
        profile: current.profile,
        resumeFile: current.resumeFile,
      });
      if (fillRes?.success === false) {
        patchSidebarState({
          error: typeof fillRes.error === "string" ? fillRes.error : "Autofill failed",
        });
        return;
      }
      const results = fillRes?.fieldResults ?? [];
      for (const row of results) {
        updateFieldState(row.id, {
          status: row.status as FieldState["status"],
          source: row.source as FieldState["source"],
          reason: row.reason,
        });
      }
      patchSidebarState({
        progress: { completed: total, total },
      });
      const openEnded = (fillRes?.openEnded ?? []) as DetectedField[];
      if (openEnded.length) {
        const out = await batchAnswer({
          questions: openEnded.map((f) => ({
            id: f.id,
            question: f.questionText?.trim() || f.label || "Open-ended question",
            charLimit: f.charLimit,
            kind: "free_text",
          })),
          jobTitle,
          companyName,
        });
        const generated = out.answers.map((a) => ({ id: a.id, answer: a.answer }));
        const aiRes = await sendRuntime<{
          success?: boolean;
          applied?: number;
          failedIds?: string[];
        }>({
          type: "FILL_TAB_AI_ANSWERS",
          answers: generated.map((r) => {
            const f = openEnded.find((x) => x.id === r.id);
            return {
              id: r.id,
              answer: r.answer,
              question: f?.questionText?.trim() || f?.label,
              selector: f?.elementSelector,
              questionHash: f?.questionHash,
              groupKey: f?.groupKey,
            };
          }),
        });
        const failedAi = new Set(aiRes?.failedIds ?? []);
        for (const f of openEnded) {
          const okOne = aiRes?.success !== false && !failedAi.has(f.id);
          updateFieldState(f.id, {
            status: okOne ? "filled" : "failed",
            source: "ai",
            reason: okOne ? undefined : "Could not apply generated answer to this field",
          });
        }
      }
    } catch (error) {
      patchSidebarState({
        error: error instanceof Error ? error.message : "Autofill failed",
      });
    } finally {
      patchSidebarState({ isRunning: false });
      await rescanFields();
    }
  };

  const runFieldGenerateAi = async (fieldId: string) => {
    if (getSidebarState().isRunning) return;
    let cur = getSidebarState();
    const row = cur.fields.find((f) => f.id === fieldId);
    const detected = cur.detectedFields.find((f) => f.id === fieldId);
    if (!row || !detected || !shouldShowGenerateWithAiButton(row, detected)) return;

    const saPre = cur.smartApplyStatus;
    if (saPre && saPre.profileComplete === false) {
      patchSidebarState({ error: "Complete your profile in JobLoom first (Smart Apply page)." });
      return;
    }
    if (saPre && typeof saPre.jobsRemaining === "number" && saPre.jobsRemaining <= 0) {
      patchSidebarState({
        error: `Daily Smart Apply limit reached. Resets at ${saPre.resetsAt ?? ""}`,
      });
      return;
    }

    const jobTitle = document.title.split(/[-|·]/)[0]?.trim() || "Role";
    const companyName = document.title.split(/[-|]/).pop()?.trim() || "Company";
    const question =
      detected.questionText?.trim() || pickDetectedFieldLabel(detected) || "Application question";

    patchSidebarState({ error: null });
    updateFieldState(fieldId, {
      status: "ai_generating",
      source: "ai",
      reason: undefined,
    });

    try {
      const out = await batchAnswer({
        questions: [
          {
            id: fieldId,
            question,
            charLimit: detected.charLimit,
            kind: "free_text",
          },
        ],
        jobTitle,
        companyName,
      });
      const answer = out.answers[0]?.answer?.trim();
      if (!answer) {
        updateFieldState(fieldId, {
          status: "failed",
          source: "ai",
          reason: "No answer returned",
        });
        return;
      }
      const aiRes = await sendRuntime<{
        success?: boolean;
        failedIds?: string[];
      }>({
        type: "FILL_TAB_AI_ANSWERS",
        answers: [
          {
            id: fieldId,
            answer,
            question,
            selector: detected.elementSelector,
            questionHash: detected.questionHash,
            groupKey: detected.groupKey,
            forceReplace: true,
          },
        ],
      });
      const failedAi = new Set(aiRes?.failedIds ?? []);
      const okOne = aiRes?.success !== false && !failedAi.has(fieldId);
      updateFieldState(fieldId, {
        status: okOne ? "filled" : "failed",
        source: "ai",
        reason: okOne ? undefined : "Could not apply generated answer to this field",
      });
    } catch (error) {
      updateFieldState(fieldId, {
        status: "failed",
        source: "ai",
        reason: error instanceof Error ? error.message : "AI generation failed",
      });
    } finally {
      await rescanFields();
    }
  };

  return (
    <>
      <FloatingTrigger open={state.isOpen} onClick={() => patchSidebarState({ isOpen: true })} />
      <div style={{ pointerEvents: "auto" }}>
        <Sidebar
          state={state}
          onClose={() => patchSidebarState({ isOpen: false })}
          onAutofill={() => void runAutofill()}
          onGenerateFieldAi={(id) => void runFieldGenerateAi(id)}
          onFieldClick={(fieldId, selector) => {
            patchSidebarState({ selectedFieldId: fieldId });
            const meta = getSidebarState().detectedFields.find((f) => f.id === fieldId);
            if (meta?.frameId != null && meta.frameId !== 0) {
              updateFieldState(fieldId, {
                reason: "Field is inside an embedded application frame; use the form directly.",
              });
              return;
            }
            const ok = highlightField(selector);
            if (!ok) {
              updateFieldState(fieldId, {
                reason: "Field not found in current DOM",
              });
            }
          }}
        />
      </div>
    </>
  );
}

