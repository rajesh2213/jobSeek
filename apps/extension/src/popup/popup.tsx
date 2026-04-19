import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  batchAnswer,
  fetchApplyProfile,
  fetchResumeFile,
  fetchSmartApplyStatus,
  postSmartApplyEvent,
} from "../lib/api";
import type { ApplyProfile, FillFieldResult, ResumeFilePayload } from "../lib/formFiller";
import { isLikelyAtsPage } from "../lib/atsDetection";
import { extensionLogoPrimUrl } from "../lib/extensionAssets";

const CORAL = "#E8533A";
const SITE = "https://jobseek.app";

type Phase = "idle" | "filling" | "generating" | "review" | "done" | "error";

type ScanField = {
  id?: string;
  isOpenEnded?: boolean;
  groupKey?: string;
  inputType?: string;
  frameId?: number;
};

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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function logicalFieldCount(fields: ScanField[]): number {
  const seen = new Set<string>();
  let count = 0;
  for (const f of fields) {
    const isChoice = f.inputType === "radio" || f.inputType === "checkbox";
    const key = isChoice
      ? `${f.frameId ?? 0}:${f.groupKey ?? f.id ?? `choice-${count}`}`
      : `single:${f.id ?? `${f.frameId ?? 0}-${count}-${f.inputType ?? "x"}`}`;
    if (isChoice) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    count++;
  }
  return count;
}

function Popup() {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof fetchSmartApplyStatus>>>(null);
  const [profile, setProfile] = useState<ApplyProfile | null>(null);
  const [tabUrl, setTabUrl] = useState<string>("");
  const [isAts, setIsAts] = useState(false);
  const [fieldCount, setFieldCount] = useState(0);
  const [openEndedCount, setOpenEndedCount] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldResults, setFieldResults] = useState<FillFieldResult[]>([]);
  const [jobTitle, setJobTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [resumeAttachMessage, setResumeAttachMessage] = useState<string | null>(null);
  const firstFillStartMsRef = useRef<number | null>(null);
  const firstSuccessSentRef = useRef(false);

  const refreshStorage = useCallback(() => {
    chrome.storage.local.get(["authToken"], (r) => {
      setToken((r.authToken as string | undefined) ?? null);
    });
  }, []);

  useEffect(() => {
    refreshStorage();
    const id = window.setInterval(refreshStorage, 2000);
    return () => window.clearInterval(id);
  }, [refreshStorage]);

  useEffect(() => {
    if (!token) {
      setStatus(null);
      setProfile(null);
      return;
    }
    void (async () => {
      const [st, raw] = await Promise.all([fetchSmartApplyStatus(), fetchApplyProfile()]);
      setStatus(st);
      setProfile(mapProfile(raw));
    })();
  }, [token]);

  const refreshTab = useCallback(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const u = tabs[0]?.url ?? "";
      setTabUrl(u);
      const host = hostOf(u);
      const tabId = tabs[0]?.id;
      if (tabId === undefined) return;
      void (async () => {
        try {
          const res = await sendRuntime<{
            success?: boolean;
            error?: string;
            fields?: ScanField[];
            isAtsPage?: boolean;
          }>({ type: "SCAN_TAB_FIELDS", tabId });
          const ats = res.isAtsPage ?? isLikelyAtsPage(u);
          setIsAts(ats);
          if (res.success === false) {
            setFieldCount(0);
            setOpenEndedCount(0);
            setError(typeof res.error === "string" ? res.error : "Field scan failed");
            return;
          }
          const fields = (res.fields ?? []) as ScanField[];
          const openEnded = fields.filter((f) => f.isOpenEnded).length;
          setFieldCount(logicalFieldCount(fields));
          setOpenEndedCount(openEnded);
          void postSmartApplyEvent("fields_detected_count", {
            hostname: host,
            totalFields: fields.length,
            openEndedFields: openEnded,
          });
        } catch {
          setFieldCount(0);
          setOpenEndedCount(0);
        }
      })();
    });
  }, []);

  useEffect(() => {
    refreshTab();
  }, [refreshTab]);

  const runFill = async () => {
    setError(null);
    setResumeAttachMessage(null);
    if (!token || !profile) {
      setError("Sign in to JobLoom and open your profile.");
      return;
    }
    if (!status?.profileComplete) {
      setError("Complete your profile in JobLoom first.");
      return;
    }
    if (status.jobsRemaining !== undefined && status.jobsRemaining <= 0) {
      setError(`Daily limit reached. Resets at ${status.resetsAt ?? ""}`);
      return;
    }

    const resumeFile = (await fetchResumeFile()) as ResumeFilePayload | null;
    firstFillStartMsRef.current ??= Date.now();
    await postSmartApplyEvent("fill_started", {
      fieldCount,
      openEndedCount,
      jobsRemaining: status.jobsRemaining,
      hasResumeFile: Boolean(resumeFile),
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      const tabId = tab?.id;
      if (tabId === undefined) return;

      setPhase("filling");
      const title = jobTitle.trim() || tab?.title?.split(/[-|·]/)[0]?.trim() || "Role";
      const company = companyName.trim() || tab?.title?.split(/[-|]/).pop()?.trim() || "Company";

      void (async () => {
        let res: {
          success?: boolean;
          error?: string;
          fieldResults?: FillFieldResult[];
          openEnded?: Array<{
            id: string;
            label?: string;
            charLimit?: number;
            elementSelector?: string;
            questionHash?: string;
            groupKey?: string;
          }>;
          resumeAttached?: boolean;
        };
        try {
          res = await sendRuntime<typeof res>({
            type: "FILL_TAB_STANDARD",
            tabId,
            profile,
            resumeFile,
          });
        } catch (e) {
          setPhase("error");
          setError(e instanceof Error ? e.message : "Could not reach page");
          return;
        }
        if (res?.success === false) {
          setPhase("error");
          setError(typeof res.error === "string" ? res.error : "Failed to fill form fields");
          return;
        }

        const runFieldResults = (res?.fieldResults ?? []) as FillFieldResult[];
        setFieldResults(runFieldResults);
        if (res?.resumeAttached === true) {
          setResumeAttachMessage("Resume attached automatically.");
        } else if (resumeFile) {
          setResumeAttachMessage("Resume upload needs manual confirmation on this ATS.");
        }

        const openEnded = (res?.openEnded ?? []) as Array<{
          id: string;
          label?: string;
          charLimit?: number;
          elementSelector?: string;
          questionHash?: string;
          groupKey?: string;
        }>;
        const openQuestionById = new Map<string, string>(
          openEnded.map((f): [string, string] => [f.id, f.label?.trim() || "Open-ended question"]),
        );
        const openSelectorById = new Map<string, string>(
          openEnded
            .filter((f): f is typeof f & { elementSelector: string } => typeof f.elementSelector === "string")
            .map((f): [string, string] => [f.id, f.elementSelector]),
        );
        const openQuestionHashById = new Map<string, string>(
          openEnded
            .filter((f): f is typeof f & { questionHash: string } => typeof f.questionHash === "string")
            .map((f): [string, string] => [f.id, f.questionHash]),
        );
        const openGroupKeyById = new Map<string, string>(
          openEnded
            .filter((f): f is typeof f & { groupKey: string } => typeof f.groupKey === "string")
            .map((f): [string, string] => [f.id, f.groupKey]),
        );

        if (!openEnded.length) {
          setPhase("done");
          await postSmartApplyEvent("fill_completed", {
            mode: "standard_only",
            filled: runFieldResults.filter((r) => r.status === "filled").length,
          });
          if (firstFillStartMsRef.current && !firstSuccessSentRef.current) {
            firstSuccessSentRef.current = true;
            await postSmartApplyEvent("session_to_first_success_time", {
              elapsedMs: Date.now() - firstFillStartMsRef.current,
            });
          }
          return;
        }

        setPhase("generating");
        try {
          const out = await batchAnswer({
            questions: openEnded.map((f) => ({
              id: f.id,
              question: f.label?.trim() || "Open-ended question",
              charLimit: f.charLimit,
              kind: "free_text",
            })),
            jobTitle: title,
            companyName: company,
          });
          const generated = out.answers.map((a) => ({
            id: a.id,
            answer: a.answer,
          }));

          const applyRes = await sendRuntime<{
            success?: boolean;
            error?: string;
            applied?: number;
            attempted?: number;
          }>({
            type: "FILL_TAB_AI_ANSWERS",
            tabId,
            answers: generated.map((r) => ({
              id: r.id,
              answer: r.answer,
              question: openQuestionById.get(r.id),
              selector: openSelectorById.get(r.id),
              questionHash: openQuestionHashById.get(r.id),
              groupKey: openGroupKeyById.get(r.id),
            })),
          });
          if (applyRes?.success === false) {
            setPhase("error");
            setError(typeof applyRes.error === "string" ? applyRes.error : "Could not apply generated answers");
            return;
          }
          const applied = Number(applyRes?.applied ?? 0);
          const attempted = Number(applyRes?.attempted ?? generated.length);
          if (attempted > 0 && applied < attempted) {
            setPhase("error");
            setError(`Applied ${applied}/${attempted} generated answers. Use Retry for remaining fields.`);
            return;
          }
          await postSmartApplyEvent("fill_completed", {
            mode: "with_ai_answers",
            answeredCount: generated.length,
          });
          if (firstFillStartMsRef.current && !firstSuccessSentRef.current) {
            firstSuccessSentRef.current = true;
            await postSmartApplyEvent("session_to_first_success_time", {
              elapsedMs: Date.now() - firstFillStartMsRef.current,
            });
          }
          setPhase("done");
        } catch (e) {
          setPhase("error");
          setError(e instanceof Error ? e.message : "Failed");
        }
      })();
    });
  };

  const retryFailedFields = async () => {
    if (!profile) return;
    const failedIds = fieldResults
      .filter((r) => r.status === "failed" || r.status === "manual_required")
      .map((r) => r.id);
    if (!failedIds.length) return;

    const resumeFile = (await fetchResumeFile()) as ResumeFilePayload | null;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId === undefined) return;
      void (async () => {
        try {
          const res = await sendRuntime<{ success?: boolean; error?: string; fieldResults?: FillFieldResult[] }>({
            type: "RETRY_TAB_FIELDS",
            tabId,
            ids: failedIds,
            profile,
            resumeFile,
          });
          if (res?.success === false) {
            setError(typeof res.error === "string" ? res.error : "Retry failed");
            return;
          }
          const runFieldResults = (res?.fieldResults ?? []) as FillFieldResult[];
          setFieldResults((prev) => {
            const byId = new Map(prev.map((r) => [r.id, r]));
            for (const row of runFieldResults) byId.set(row.id, row);
            return Array.from(byId.values());
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : "Retry failed");
        }
      })();
    });
  };

  const undoLastFillClick = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId === undefined) return;
      void (async () => {
        try {
          const res = await sendRuntime<{ success?: boolean; error?: string; restored?: number }>({
            type: "UNDO_TAB_FILL",
            tabId,
          });
          if (res?.success === false) {
            setError(typeof res.error === "string" ? res.error : "Undo failed");
            return;
          }
          setError(`Undo restored ${Number(res?.restored ?? 0)} fields.`);
          setPhase("idle");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Undo failed");
        }
      })();
    });
  };

  const failedFieldCount = useMemo(
    () => fieldResults.filter((r) => r.status === "failed" || r.status === "manual_required").length,
    [fieldResults],
  );

  if (!token) {
    return (
      <div style={{ padding: 20, textAlign: "center" }}>
        <img
          src={extensionLogoPrimUrl()}
          alt=""
          style={{ height: 48, width: "auto", margin: "0 auto 10px", display: "block", objectFit: "contain" }}
        />
        <p style={{ margin: "0 0 12px", fontWeight: 700 }}>JobLoom Smart Apply</p>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#555" }}>
          Sign in to JobLoom to use Smart Apply
        </p>
        <button
          type="button"
          onClick={() => chrome.tabs.create({ url: `${SITE}/sign-in` })}
          style={{
            background: CORAL,
            color: "white",
            border: "none",
            borderRadius: 10,
            padding: "10px 16px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Sign in →
        </button>
        <p style={{ marginTop: 12, fontSize: 11, color: "#888" }}>
          Paste your Clerk session token in extension storage key `authToken` (dev).
        </p>
      </div>
    );
  }

  if (!isAts) {
    return (
      <div style={{ padding: 16 }}>
        <p style={{ margin: 0, fontWeight: 800, fontSize: 14 }}>Smart Apply</p>
        <p style={{ margin: "8px 0", fontSize: 13, color: "#555" }}>Ready to fill forms</p>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "#777" }}>
          Navigate to a job application page (Greenhouse, Lever, Workday, Ashby, ...).
        </p>
        {status ? (
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                height: 6,
                background: "#e0e0e0",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, (status.jobsToday / Math.max(1, status.jobsLimit)) * 100)}%`,
                  height: "100%",
                  background: CORAL,
                }}
              />
            </div>
            <p style={{ fontSize: 11, marginTop: 6, color: "#666" }}>
              {status.jobsToday} of {status.jobsLimit} jobs today
            </p>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => chrome.tabs.create({ url: `${SITE}/smart-apply` })}
          style={{
            display: "block",
            width: "100%",
            marginBottom: 8,
            padding: 10,
            borderRadius: 8,
            border: `1px solid ${CORAL}`,
            background: "white",
            color: CORAL,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Set up profile →
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <img
          src={extensionLogoPrimUrl()}
          alt=""
          style={{ height: 36, width: "auto", objectFit: "contain" }}
        />
        <span style={{ fontWeight: 800 }}>Smart Apply</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            background: "#fef3c7",
            color: "#92400e",
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          JobLoom Smart Apply
        </span>
      </div>
      <p style={{ fontSize: 12, color: "#555", margin: "0 0 6px" }}>
        {fieldCount} fields detected on {tabUrl ? hostOf(tabUrl) : "page"}
      </p>
      <p style={{ fontSize: 12, margin: "0 0 8px" }}>
        {openEndedCount} long question{openEndedCount === 1 ? "" : "s"}
      </p>

      <label style={{ fontSize: 11, display: "block", marginBottom: 4 }}>
        Job title (optional)
        <input
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          style={{ width: "100%", marginTop: 4, padding: 6, borderRadius: 6, border: "1px solid #ccc" }}
        />
      </label>
      <label style={{ fontSize: 11, display: "block", marginBottom: 4 }}>
        Company (optional)
        <input
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          style={{ width: "100%", marginTop: 4, padding: 6, borderRadius: 6, border: "1px solid #ccc" }}
        />
      </label>

      {resumeAttachMessage ? (
        <p style={{ color: "#166534", fontSize: 12, margin: "8px 0" }}>{resumeAttachMessage}</p>
      ) : null}
      {error ? (
        <p style={{ color: "#b91c1c", fontSize: 12, margin: "8px 0" }}>{error}</p>
      ) : null}

      {phase === "idle" || phase === "error" ? (
        <button
          type="button"
          onClick={() => void runFill()}
          style={{
            width: "100%",
            marginTop: 8,
            padding: 12,
            borderRadius: 10,
            border: "none",
            background: CORAL,
            color: "white",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Fill application
        </button>
      ) : null}

      {phase === "filling" ? <p style={{ fontSize: 12 }}>Filling fields...</p> : null}
      {phase === "generating" ? <p style={{ fontSize: 12 }}>Generating long-answer drafts...</p> : null}

      {fieldResults.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 12, fontWeight: 700, margin: "0 0 6px" }}>Field status</p>
          <div style={{ maxHeight: 130, overflow: "auto", border: "1px solid #eee", borderRadius: 8 }}>
            {fieldResults.map((row) => (
              <div
                key={row.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  borderBottom: "1px solid #f0f0f0",
                  padding: "6px 8px",
                  gap: 8,
                }}
              >
                <span style={{ flex: 1 }}>{row.label || row.fieldType}</span>
                <span style={{ color: row.status === "filled" ? "#166534" : "#92400e", textAlign: "right" }}>
                  {row.status.replace("_", " ")}
                  {row.source ? ` · ${row.source}` : ""}
                  {row.confidence ? ` · ${row.confidence}` : ""}
                </span>
              </div>
            ))}
          </div>
          {failedFieldCount > 0 ? (
            <button
              type="button"
              onClick={() => void retryFailedFields()}
              style={{
                marginTop: 6,
                width: "100%",
                padding: 8,
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "white",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Retry {failedFieldCount} incomplete field{failedFieldCount === 1 ? "" : "s"}
            </button>
          ) : null}
        </div>
      ) : null}

      {(phase === "done" || phase === "error") && fieldResults.length > 0 ? (
        <button
          type="button"
          onClick={undoLastFillClick}
          style={{
            marginTop: 8,
            width: "100%",
            padding: 8,
            borderRadius: 8,
            border: "1px solid #ddd",
            background: "white",
            cursor: "pointer",
          }}
        >
          Undo last fill
        </button>
      ) : null}

      {phase === "review" ? null : null}

      {phase === "done" ? (
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 11, color: "#166534" }}>
            Form prepared. Review and click submit on the application page.
          </p>
          <button
            type="button"
            onClick={() => setPhase("idle")}
            style={{
              marginTop: 8,
              width: "100%",
              padding: 8,
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>
      ) : null}
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<Popup />);
}
