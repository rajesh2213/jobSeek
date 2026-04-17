import { useEffect, useState } from "react";
import type { ApplyProfile } from "../lib/formFiller";
import { fetchApplyProfile, fetchResumeFile } from "../lib/api";
import { batchAnswer } from "../lib/api";
import { highlightField } from "../lib/autofill/highlight";
import { FloatingTrigger } from "./FloatingTrigger";
import { Sidebar } from "./Sidebar";
import {
  getSidebarState,
  patchSidebarState,
  resetFieldStates,
  setDetectedFields,
  subscribeSidebarState,
  updateFieldState,
  type FieldState,
} from "./store";
import type { DetectedField } from "../lib/fieldDetector";

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
    pronouns: typeof extras.pronouns === "string" ? extras.pronouns : undefined,
    hearAbout: typeof extras.hearAbout === "string" ? extras.hearAbout : undefined,
    hasResume: typeof raw.hasResume === "boolean" ? raw.hasResume : undefined,
  };
}

export function SidebarApp(props: { isAtsPage: boolean }) {
  const [state, setState] = useState(getSidebarState());

  useEffect(() => subscribeSidebarState(() => setState({ ...getSidebarState() })), []);

  useEffect(() => {
    patchSidebarState({ atsDetected: props.isAtsPage, isVisible: props.isAtsPage });
    if (!props.isAtsPage) return;
    const refresh = async () => {
      try {
        const res = await sendRuntime<{ success?: boolean; fields?: DetectedField[] }>({
          type: "SCAN_TAB_FIELDS",
        });
        if (res?.success !== false && Array.isArray(res.fields)) {
          setDetectedFields(res.fields);
        }
      } catch {
        // ignore
      }
      const raw = await fetchApplyProfile();
      const resumeFile = await fetchResumeFile();
      patchSidebarState({
        profile: mapProfile(raw),
        resumeFile,
      });
    };
    void refresh();
    const observer = new MutationObserver(() => {
      window.clearTimeout((window as Window & { __jobseekRescanTimer?: number }).__jobseekRescanTimer);
      (window as Window & { __jobseekRescanTimer?: number }).__jobseekRescanTimer = window.setTimeout(() => {
        if (getSidebarState().isRunning) return;
        void (async () => {
          try {
            const res = await sendRuntime<{ success?: boolean; fields?: DetectedField[] }>({
              type: "SCAN_TAB_FIELDS",
            });
            if (res?.success !== false && Array.isArray(res.fields)) {
              setDetectedFields(res.fields);
            }
          } catch {
            // ignore
          }
        })();
      }, 350);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [props.isAtsPage]);

  useEffect(() => {
    if (!state.atsDetected) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlTransition = html.style.transition;
    const prevBodyTransition = body.style.transition;
    const prevBodyTransform = body.style.transform;
    const prevBodyTransformOrigin = body.style.transformOrigin;
    body.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
    html.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
    body.style.transformOrigin = "center center";
    body.style.transform = state.isOpen ? "translateX(-56px)" : "";
    return () => {
      html.style.transition = prevHtmlTransition;
      body.style.transition = prevBodyTransition;
      body.style.transform = prevBodyTransform;
      body.style.transformOrigin = prevBodyTransformOrigin;
    };
  }, [state.isOpen, state.atsDetected]);

  if (!state.isVisible || !state.atsDetected) return null;

  const rescanFields = async () => {
    const res = await sendRuntime<{ success?: boolean; fields?: DetectedField[] }>({
      type: "SCAN_TAB_FIELDS",
    });
    const fields = res?.fields ?? [];
    if (res?.success !== false && Array.isArray(res.fields)) {
      setDetectedFields(res.fields);
    }
    return fields;
  };

  const runAutofill = async () => {
    let current = getSidebarState();
    if (current.isRunning) return;
    if (!current.profile) {
      try {
        const raw = await fetchApplyProfile();
        const resumeFile = await fetchResumeFile();
        patchSidebarState({ profile: mapProfile(raw), resumeFile });
      } catch (error) {
        patchSidebarState({
          error: error instanceof Error ? error.message : "Could not load Smart Apply profile",
        });
        return;
      }
      current = getSidebarState();
      if (!current.profile) {
        patchSidebarState({ error: "Set up your Smart Apply profile before autofill." });
        return;
      }
    }
    if (!current.resumeFile) {
      try {
        const raw = await fetchApplyProfile();
        patchSidebarState({ profile: mapProfile(raw) });
        const resumeFile = await fetchResumeFile();
        patchSidebarState({ resumeFile });
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
            ? "Smart Apply shows a resume, but the original PDF is not available to download (profile may be text-only). Re-upload your PDF on the JobSeek Smart Apply page, then try again."
            : "Resume file is unavailable. Re-upload resume in JobSeek and try again.";
        patchSidebarState({ error: noBytesHint });
        return;
      }
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
        const aiRes = await sendRuntime<{ success?: boolean; applied?: number }>({
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
        const aiApplied = aiRes?.applied ?? 0;
        const aiOk = aiRes?.success !== false && aiApplied >= openEnded.length;
        for (const f of openEnded) {
          updateFieldState(f.id, {
            status: aiOk ? "filled" : "failed",
            source: "ai",
            reason: aiOk ? undefined : "Could not apply all generated answers",
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

  return (
    <>
      <FloatingTrigger open={state.isOpen} onClick={() => patchSidebarState({ isOpen: true })} />
      <div style={{ pointerEvents: "auto" }}>
        <Sidebar
          state={state}
          onClose={() => patchSidebarState({ isOpen: false })}
          onAutofill={() => void runAutofill()}
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

