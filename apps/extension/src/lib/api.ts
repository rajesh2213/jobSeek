import { getDefaultApiBase, resolveApiBaseFromStorage } from "../config";
import { API_PATHS } from "./allowedApiPaths";

async function getApiBase(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get(["apiBase"], (r) => {
      resolve(
        resolveApiBaseFromStorage(r.apiBase as string | undefined, getDefaultApiBase()),
      );
    });
  });
}

async function getToken(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(["authToken"], (r) => {
      resolve((r.authToken as string | undefined) ?? null);
    });
  });
}

type ProxyResponse<T = unknown> = {
  ok: boolean;
  status: number;
  data?: T;
  /** Binary payloads from background (reliable vs raw ArrayBuffer in messages). */
  dataBase64?: string;
  error?: string;
  headers?: Record<string, string>;
};

function base64ToArrayBuffer(base64: string): ArrayBuffer | null {
  try {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch {
    return null;
  }
}

function toArrayBuffer(input: unknown): ArrayBuffer | null {
  if (!input) return null;
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) {
    const view = input as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }
  if (Array.isArray(input) && input.every((n) => typeof n === "number")) {
    return new Uint8Array(input).buffer;
  }
  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.data) && obj.data.every((n) => typeof n === "number")) {
      return new Uint8Array(obj.data as number[]).buffer;
    }
    const numericKeys = Object.keys(obj)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    if (numericKeys.length > 0) {
      const values = numericKeys
        .map((k) => obj[k])
        .filter((v): v is number => typeof v === "number");
      if (values.length) return new Uint8Array(values).buffer;
    }
  }
  return null;
}

async function proxyApiRequest<T = unknown>(params: {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  auth?: boolean;
  responseType?: "json" | "text" | "arrayBuffer";
}): Promise<ProxyResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "API_REQUEST",
        ...params,
      },
      (res: ProxyResponse<T>) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            status: 0,
            error: chrome.runtime.lastError.message ?? "API proxy unavailable",
          });
          return;
        }
        resolve(res);
      },
    );
  });
}

export type ExtensionApiFetchMeta = {
  ok: boolean;
  status: number;
  error?: string;
  /** Fastify `/account/*` may include these on 401 when not in production API mode. */
  authHint?: string;
  authFailureCode?: string;
};

function metaFromProxy401Json<T extends Record<string, unknown>>(
  res: ProxyResponse<T>,
): Pick<ExtensionApiFetchMeta, "authHint" | "authFailureCode"> {
  const data = res.data;
  if (!data || typeof data !== "object") return {};

  let obj: Record<string, unknown> = data as Record<string, unknown>;
  const raw = obj.raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t.startsWith("{")) {
      try {
        const parsed = JSON.parse(t) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          obj = parsed as Record<string, unknown>;
        }
      } catch {
        /* keep obj */
      }
    }
  }

  const authHint = typeof obj.authHint === "string" ? obj.authHint : undefined;
  const authFailureCode = typeof obj.authFailureCode === "string" ? obj.authFailureCode : undefined;
  return { authHint, authFailureCode };
}

export async function fetchApplyProfileDetailed(): Promise<
  { profile: Record<string, unknown> | null } & ExtensionApiFetchMeta
> {
  const token = await getToken();
  if (!token) {
    return {
      profile: null,
      ok: false,
      status: 0,
      error: "No auth token in extension storage",
    };
  }
  const res = await proxyApiRequest<Record<string, unknown>>({
    path: API_PATHS.applyProfile,
    auth: true,
    responseType: "json",
  });
  const hints = res.status === 401 ? metaFromProxy401Json(res) : {};
  return {
    profile: res.ok ? ((res.data ?? null) as Record<string, unknown> | null) : null,
    ok: res.ok,
    status: res.status,
    error: res.error,
    ...hints,
  };
}

export async function fetchApplyProfile() {
  const r = await fetchApplyProfileDetailed();
  return r.profile;
}

export type SmartApplyStatusPayload = {
  jobsToday: number;
  jobsLimit: number;
  jobsRemaining: number;
  resetsAt: string;
  plan: string;
  profileComplete: boolean;
  profileCompletionPct: number;
};

export async function fetchSmartApplyStatusDetailed(): Promise<
  { snapshot: SmartApplyStatusPayload | null } & ExtensionApiFetchMeta
> {
  const token = await getToken();
  if (!token) {
    return {
      snapshot: null,
      ok: false,
      status: 0,
      error: "No auth token in extension storage",
    };
  }
  const res = await proxyApiRequest<SmartApplyStatusPayload>({
    path: API_PATHS.smartApplyStatus,
    auth: true,
    responseType: "json",
  });
  const hints =
    res.status === 401 ? metaFromProxy401Json(res as ProxyResponse<Record<string, unknown>>) : {};
  return {
    snapshot: res.ok ? (res.data ?? null) : null,
    ok: res.ok,
    status: res.status,
    error: res.error,
    ...hints,
  };
}

export async function fetchSmartApplyStatus() {
  const r = await fetchSmartApplyStatusDetailed();
  return r.snapshot;
}

/** Non-null payload from `/account/smart-apply/status` (for sidebar / store). */
export type SmartApplyStatusSnapshot = NonNullable<Awaited<ReturnType<typeof fetchSmartApplyStatus>>>;

export type SmartApplyBatchQuestionKind = "structured" | "free_text";

export type SmartApplyPreferenceOverrides = {
  tone?: "professional" | "friendly" | "formal" | "casual";
  length?: "short" | "medium" | "long";
  firstPerson?: boolean;
};

export async function batchAnswer(params: {
  questions: Array<{
    id: string;
    question: string;
    charLimit?: number;
    /** Hint for server: narrative fields vs short factual prompts. */
    kind?: SmartApplyBatchQuestionKind;
  }>;
  jobTitle: string;
  companyName: string;
  /** Overrides saved /smart-apply preferences for this fill only. */
  preferenceOverrides?: SmartApplyPreferenceOverrides;
}) {
  const [base, token] = await Promise.all([getApiBase(), getToken()]);
  if (!token) throw new Error("Not authenticated");
  const proxied = await proxyApiRequest<{
    answers: Array<{ id: string; answer: string }>;
    answerMeta?: Array<{
      id: string;
      source: "structured" | "llm";
      confidence: "high" | "medium" | "low";
    }>;
    tokensUsed: number;
    jobsRemainingToday: number;
    jobsLimit: number;
    resetAt?: string;
  }>({
    path: API_PATHS.smartApplyBatchAnswer,
    method: "POST",
    auth: true,
    responseType: "json",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (proxied.status === 429) {
    const resetAt = proxied.data && typeof proxied.data === "object" ? (proxied.data as { resetAt?: string }).resetAt : "";
    throw new Error(`Daily limit reached. Resets at ${resetAt ?? ""}`);
  }
  if (proxied.status === 403) throw new Error("Upgrade to Pro to use Smart Apply");
  if (!proxied.ok || !proxied.data) {
    throw new Error(proxied.error || `Failed to generate answers (${base})`);
  }
  return proxied.data;
}

export type SmartApplyEventName =
  | "resume_uploaded"
  | "extension_installed_clicked"
  | "ats_page_detected"
  | "fields_detected_count"
  | "fill_started"
  | "fill_completed"
  | "long_answer_generated_count"
  | "answer_edited_before_apply"
  | "session_to_first_success_time";

export async function postSmartApplyEvent(
  event: SmartApplyEventName,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const [base, token] = await Promise.all([getApiBase(), getToken()]);
  if (!token) return;
  await proxyApiRequest({
    path: API_PATHS.smartApplyEvents,
    method: "POST",
    auth: true,
    responseType: "json",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event, payload }),
  });
  void base;
}

export async function fetchResumeFile(): Promise<{
  fileName: string;
  contentType: string;
  bytes: ArrayBuffer;
} | null> {
  const [base, token] = await Promise.all([getApiBase(), getToken()]);
  if (!token) return null;
  const res = await proxyApiRequest<ArrayBuffer>({
    path: API_PATHS.resumeDownload,
    auth: true,
    responseType: "arrayBuffer",
  });
  if (!res.ok) return null;

  const contentType = res.headers?.["content-type"] ?? "application/pdf";
  const disposition = res.headers?.["content-disposition"] ?? "";
  const fileNameMatch = disposition.match(/filename=\"?([^\";]+)\"?/i);
  const fileName = decodeURIComponent(fileNameMatch?.[1] ?? "resume.pdf");
  const bytes =
    typeof res.dataBase64 === "string" && res.dataBase64.length > 0
      ? base64ToArrayBuffer(res.dataBase64)
      : toArrayBuffer(res.data);
  if (!bytes || bytes.byteLength === 0) return null;
  void base;
  return { fileName, contentType, bytes };
}

export async function markApplied(jobId: string) {
  const [base, token] = await Promise.all([getApiBase(), getToken()]);
  if (!token) return;
  await proxyApiRequest({
    path: API_PATHS.applications,
    method: "POST",
    auth: true,
    responseType: "json",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jobId }),
  });
  void base;
}
