import { useEffect, useState } from "react";
import type { ApplyProfile } from "../lib/formFiller";
import {
  fetchApplyProfileDetailed,
  fetchResumeFile,
  fetchSmartApplyStatusDetailed,
} from "../lib/api";
import { batchAnswer, consumeSmartApplyUse } from "../lib/api";
import { highlightField } from "../lib/autofill/highlight";
import { clearAllAiFieldChrome, setAiFieldGenerating } from "../lib/autofill/aiFieldChrome";
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
import { fillAllTabAiAnswers, fillAllTabStandard } from "../lib/fillPageFields";
import { collectAiAutofillFields } from "../lib/aiNarrativeFields";
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

const SIGN_IN_HINT =
  "Use Open website account below or visit jobloom.tech to sign in.";

function buildAccountSyncHint(
  p: Awaited<ReturnType<typeof fetchApplyProfileDetailed>>,
  s: Awaited<ReturnType<typeof fetchSmartApplyStatusDetailed>>,
  hasAuthToken?: boolean | null,
): string | null {
  if (hasAuthToken === false) return null;

  const noStoredToken =
    p.error === "No auth token in extension storage" ||
    s.error === "No auth token in extension storage";
  if (noStoredToken) return null;

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

async function refreshSmartApplyStatus(): Promise<void> {
  const sd = await fetchSmartApplyStatusDetailed();
  patchSidebarState({ smartApplyStatus: sd.snapshot });
}

async function loadAccountSnapshotIntoSidebar(): Promise<void> {
  const hasAuthToken = await new Promise<boolean>((resolve) => {
    chrome.storage.local.get(["authToken"], (r) => {
      resolve(Boolean(r.authToken as string | undefined));
    });
  });
  const [pd, resumeFile, sd] = await Promise.all([
    fetchApplyProfileDetailed(),
    fetchResumeFile(),
    fetchSmartApplyStatusDetailed(),
  ]);
  const profileFileName =
    pd.profile && typeof pd.profile.resumeFileName === "string"
      ? pd.profile.resumeFileName.trim()
      : "";
  const resolvedResume =
    resumeFile && profileFileName && (!resumeFile.fileName || resumeFile.fileName === "resume.pdf")
      ? { ...resumeFile, fileName: profileFileName }
      : resumeFile;
  patchSidebarState({
    profile: mapProfile(pd.profile),
    resumeFile: resolvedResume,
    smartApplyStatus: sd.snapshot,
    accountDataLoaded: true,
    hasAuthToken,
    accountSyncHint: buildAccountSyncHint(pd, sd, hasAuthToken),
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
        const has = Boolean(r.authToken as string | undefined);
        const prev = getSidebarState().hasAuthToken;
        patchSidebarState({
          hasAuthToken: has,
          ...(has ? { error: null } : {}),
        });
        if (!has) {
          patchSidebarState({
            profile: null,
            smartApplyStatus: null,
            resumeFile: null,
            accountSyncHint: null,
            accountDataLoaded: true,
          });
          return;
        }
        if (prev !== true && getSidebarState().atsDetected) {
          void loadAccountSnapshotIntoSidebar().catch(() => undefined);
        }
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
      const accountPromise = loadAccountSnapshotIntoSidebar().catch(() => {
        patchSidebarState({
          accountDataLoaded: true,
          accountSyncHint: "Could not load account. Check connection or sign in on jobloom.tech.",
        });
      });
      try {
        const fields = await scanAllPageFields(sendRuntime);
        setDetectedFields(fields);
      } catch {
        // ignore
      }
      await accountPromise;
    };
    void refresh();
    const delayedRescan = window.setTimeout(() => {
      if (getSidebarState().detectedFields.length === 0 && !getSidebarState().isRunning) {
        void scanAllPageFields(sendRuntime).then(setDetectedFields).catch(() => undefined);
      }
    }, 2000);
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
    return () => {
      window.clearTimeout(delayedRescan);
      observer.disconnect();
    };
  }, [props.isAtsPage]);

  useEffect(() => {
    if (!props.isAtsPage) return;
    const syncAiChrome = () => {
      const { fields, detectedFields } = getSidebarState();
      const generating = new Set(
        fields.filter((f) => f.status === "ai_generating").map((f) => f.id),
      );
      for (const meta of detectedFields) {
        setAiFieldGenerating(meta.elementSelector, generating.has(meta.id));
      }
    };
    const unsub = subscribeSidebarState(syncAiChrome);
    syncAiChrome();
    return () => {
      unsub();
      clearAllAiFieldChrome();
    };
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
        accountSyncHint: buildAccountSyncHint(pd, sd, getSidebarState().hasAuthToken),
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

  const rescanFields = async (options?: { revealHidden?: boolean }) => {
    const fields = await scanAllPageFields(sendRuntime, options);
    setDetectedFields(fields);
    return fields;
  };

  const runAutofill = async () => {
    let current = getSidebarState();
    if (current.isRunning) return;
    patchSidebarState({ isRunning: true, error: null });
    if (current.hasAuthToken === false) {
      patchSidebarState({ isRunning: false, error: SIGN_IN_HINT });
      return;
    }
    if (!current.profile) {
      try {
        await loadAccountSnapshotIntoSidebar();
      } catch (error) {
        patchSidebarState({
          isRunning: false,
          error: error instanceof Error ? error.message : "Could not load Smart Apply profile",
        });
        return;
      }
      current = getSidebarState();
      if (!current.profile) {
        patchSidebarState({
          isRunning: false,
          error:
            current.hasAuthToken === false
              ? SIGN_IN_HINT
              : current.accountSyncHint ?? "Set up your Smart Apply profile before autofill.",
        });
        return;
      }
    }
    if (!current.resumeFile) {
      try {
        await loadAccountSnapshotIntoSidebar();
      } catch (error) {
        patchSidebarState({
          isRunning: false,
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
        patchSidebarState({ isRunning: false, error: noBytesHint });
        return;
      }
    }
    current = getSidebarState();
    const saPre = current.smartApplyStatus;
    if (saPre && saPre.profileComplete === false) {
      patchSidebarState({
        isRunning: false,
        error: "Complete your profile in JobLoom first (Smart Apply page).",
      });
      return;
    }
    if (saPre && typeof saPre.jobsRemaining === "number" && saPre.jobsRemaining <= 0) {
      patchSidebarState({
        isRunning: false,
        error: `Daily Smart Apply limit reached. Resets at ${saPre.resetsAt ?? ""}`,
      });
      return;
    }
    await rescanFields({ revealHidden: true });
    const total = getSidebarState().detectedFields.length;
    if (!total) {
      patchSidebarState({
        isRunning: false,
        error: "No fillable application fields detected on this page.",
      });
      return;
    }
    const aiFields = collectAiAutofillFields(getSidebarState().detectedFields);
    resetFieldStates();
    patchSidebarState({
      isOpen: true,
      error: null,
      progress: { completed: 0, total },
    });
    for (const f of aiFields) {
      updateFieldState(f.id, { status: "ai_generating", source: "ai" });
    }
    const jobTitle = document.title.split(/[-|·]/)[0]?.trim() || "Role";
    const companyName = document.title.split(/[-|]/).pop()?.trim() || "Company";
    try {
      const fillRes = await fillAllTabStandard(sendRuntime, current.profile, current.resumeFile);
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
      const openEndedFromFill = (fillRes?.openEnded ?? []) as DetectedField[];
      const openEnded = collectAiAutofillFields([
        ...openEndedFromFill,
        ...getSidebarState().detectedFields,
      ]);
      if (openEnded.length) {
        const saNow = getSidebarState().smartApplyStatus;
        if (saNow && typeof saNow.jobsRemaining === "number" && saNow.jobsRemaining <= 0) {
          patchSidebarState({
            error: `Daily Smart Apply limit reached (${saNow.jobsLimit} uses). AI answers were not generated. Resets at ${saNow.resetsAt ?? ""}.`,
          });
          for (const f of openEnded) {
            updateFieldState(f.id, {
              status: "manual_required",
              source: "ai",
              reason: "Daily Smart Apply limit reached",
            });
          }
        } else {
          const out = await batchAnswer({
            questions: openEnded.map((f) => ({
              id: f.id,
              question:
                pickDetectedFieldLabel(f) ||
                f.questionText?.trim() ||
                f.label ||
                "Open-ended question",
              charLimit: f.charLimit,
              kind: "free_text",
            })),
            jobTitle,
            companyName,
          });
          await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
          const freshFields = await rescanFields();
          const freshByHash = new Map(
            freshFields.filter((f) => f.questionHash).map((f) => [f.questionHash as string, f]),
          );
          const generated = out.answers.map((a) => ({ id: a.id, answer: a.answer }));
          const aiRes = await fillAllTabAiAnswers(
            sendRuntime,
            generated.map((r) => {
              const f =
                openEnded.find((x) => x.id === r.id) ??
                freshByHash.get(
                  openEnded.find((x) => x.id === r.id)?.questionHash ?? "",
                );
              const fresh =
                freshFields.find((x) => x.id === f?.id) ??
                (f?.questionHash ? freshByHash.get(f.questionHash) : undefined) ??
                f;
              const question = fresh
                ? pickDetectedFieldLabel(fresh)
                : f
                  ? pickDetectedFieldLabel(f)
                  : undefined;
              return {
                id: r.id,
                answer: r.answer,
                question,
                selector: fresh?.elementSelector ?? f?.elementSelector,
                questionHash: fresh?.questionHash ?? f?.questionHash,
                groupKey: fresh?.groupKey ?? f?.groupKey,
                forceReplace: true,
              };
            }),
          );
          const usedLlm =
            (out.tokensUsed ?? 0) > 0 ||
            out.answerMeta?.some((m) => m.source === "llm") === true;
          if ((aiRes?.applied ?? 0) > 0 && usedLlm) {
            await consumeSmartApplyUse();
          }
          await refreshSmartApplyStatus();
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
      await refreshSmartApplyStatus();
      const saLive = getSidebarState().smartApplyStatus;
      if (saLive && typeof saLive.jobsRemaining === "number" && saLive.jobsRemaining <= 0) {
        updateFieldState(fieldId, {
          status: "manual_required",
          source: "ai",
          reason: "Daily Smart Apply limit reached",
        });
        patchSidebarState({
          error: `Daily Smart Apply limit reached. Resets at ${saLive.resetsAt ?? ""}`,
        });
        return;
      }
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
      const aiRes = await fillAllTabAiAnswers(sendRuntime, [
        {
          id: fieldId,
          answer,
          question,
          selector: detected.elementSelector,
          questionHash: detected.questionHash,
          groupKey: detected.groupKey,
          forceReplace: true,
        },
      ]);
      const failedAi = new Set(aiRes?.failedIds ?? []);
      const okOne = aiRes?.success !== false && !failedAi.has(fieldId);
      if (okOne) {
        const usedLlm =
          (out.tokensUsed ?? 0) > 0 ||
          out.answerMeta?.some((m) => m.source === "llm") === true;
        if (usedLlm) {
          await consumeSmartApplyUse();
        }
      }
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
      await refreshSmartApplyStatus();
      await rescanFields();
    }
  };

  return (
    <>
      <FloatingTrigger open={state.isOpen} onClick={() => patchSidebarState({ isOpen: true })} />
      <div style={{ pointerEvents: "auto" }}>
        <Sidebar
          state={state}
          extensionVersion={chrome.runtime.getManifest().version}
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

