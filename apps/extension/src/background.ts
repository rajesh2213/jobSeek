import { compositeFieldId, parseCompositeFieldId } from "./lib/frameIds";
import { isLikelyAtsPage } from "./lib/atsDetection";

const DEFAULT_API = "https://jobseek-server.up.railway.app";

type ApiRequestMessage = {
  type: "API_REQUEST";
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  auth?: boolean;
  responseType?: "json" | "text" | "arrayBuffer";
};

type DetectedFieldPayload = Record<string, unknown> & { id: string };

type FillFieldResultPayload = {
  id: string;
  label: string;
  fieldType: string;
  status: string;
  reason?: string;
  source?: string;
  confidence?: string;
};

async function getStorage(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result as Record<string, unknown>));
  });
}

function mergeDetectedFields(frameId: number, fields: DetectedFieldPayload[]) {
  return fields.map((f) => ({
    ...f,
    frameId,
    localId: f.id,
    id: compositeFieldId(frameId, f.id),
  }));
}

function mergeFillFieldResults(frameId: number, rows: FillFieldResultPayload[]): FillFieldResultPayload[] {
  return rows.map((r) => ({
    ...r,
    id: compositeFieldId(frameId, r.id),
  }));
}

async function scanTabFields(tabId: number) {
  let frames: chrome.webNavigation.GetAllFrameResultDetails[] = [];
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch (e) {
    return {
      success: false as const,
      error: e instanceof Error ? e.message : "Could not list frames",
      fields: [] as DetectedFieldPayload[],
      isAtsPage: false,
    };
  }
  const merged: DetectedFieldPayload[] = [];
  for (const { frameId, url } of frames) {
    if (!url || url.startsWith("chrome-extension:")) continue;
    try {
      const res = (await chrome.tabs.sendMessage(
        tabId,
        { type: "SCAN_FIELDS" },
        { frameId },
      )) as { success?: boolean; fields?: DetectedFieldPayload[] } | undefined;
      if (res?.success && Array.isArray(res.fields)) {
        merged.push(...mergeDetectedFields(frameId, res.fields));
      }
    } catch {
      // Frame may not run content scripts (e.g. chrome://, blocked embed).
    }
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const tabUrl = tab?.url ?? "";
  const isAtsPage = isLikelyAtsPage(tabUrl);
  return { success: true as const, fields: merged, isAtsPage, tabUrl };
}

async function fillTabStandard(
  tabId: number,
  profile: unknown,
  resumeFile: unknown,
): Promise<Record<string, unknown>> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const fieldResults: FillFieldResultPayload[] = [];
  const openEnded: DetectedFieldPayload[] = [];
  const filled: string[] = [];
  const skipped: string[] = [];
  let resumeAttached = false;

  for (const { frameId, url } of frames) {
    if (!url || url.startsWith("chrome-extension:")) continue;
    try {
      const res = (await chrome.tabs.sendMessage(
        tabId,
        { type: "FILL_STANDARD", profile, resumeFile },
        { frameId },
      )) as {
        success?: boolean;
        fieldResults?: FillFieldResultPayload[];
        openEnded?: DetectedFieldPayload[];
        filled?: string[];
        skipped?: string[];
        resumeAttached?: boolean;
      };
      if (!res || res.success === false) continue;
      if (Array.isArray(res.fieldResults)) {
        fieldResults.push(...mergeFillFieldResults(frameId, res.fieldResults));
      }
      if (Array.isArray(res.openEnded)) {
        openEnded.push(...mergeDetectedFields(frameId, res.openEnded));
      }
      if (Array.isArray(res.filled)) {
        filled.push(...res.filled.map((l) => `${frameId}:${l}`));
      }
      if (Array.isArray(res.skipped)) {
        skipped.push(...res.skipped.map((l) => `${frameId}:${l}`));
      }
      if (res.resumeAttached) resumeAttached = true;
    } catch {
      // ignore
    }
  }

  return {
    success: true,
    fieldResults,
    openEnded,
    filled,
    skipped,
    resumeAttached,
  };
}

type AiAnswerPayload = {
  id: string;
  answer: string;
  question?: string;
  selector?: string;
  questionHash?: string;
  groupKey?: string;
};

async function fillTabAiAnswers(tabId: number, answers: AiAnswerPayload[]) {
  const byFrame = new Map<number, AiAnswerPayload[]>();
  for (const a of answers) {
    const parsed = parseCompositeFieldId(a.id);
    if (!parsed) continue;
    const { frameId, localId } = parsed;
    const list = byFrame.get(frameId) ?? [];
    list.push({ ...a, id: localId });
    byFrame.set(frameId, list);
  }

  let applied = 0;
  const failedIds: string[] = [];

  for (const [frameId, payload] of byFrame) {
    if (!payload.length) continue;
    try {
      const res = (await chrome.tabs.sendMessage(
        tabId,
        { type: "FILL_AI_ANSWERS", answers: payload },
        { frameId },
      )) as { success?: boolean; attempted?: number; applied?: number; failedIds?: string[] };
      if (res && res.success !== false) {
        applied += Number(res.applied ?? 0);
        if (Array.isArray(res.failedIds)) {
          for (const fid of res.failedIds) {
            failedIds.push(compositeFieldId(frameId, fid));
          }
        }
      }
    } catch {
      for (const a of payload) {
        failedIds.push(compositeFieldId(frameId, a.id));
      }
    }
  }

  return { success: true, attempted: answers.length, applied, failedIds };
}

async function retryTabFields(
  tabId: number,
  ids: string[],
  profile: unknown,
  resumeFile: unknown,
): Promise<Record<string, unknown>> {
  const byFrame = new Map<number, string[]>();
  for (const id of ids) {
    const parsed = parseCompositeFieldId(id);
    if (parsed) {
      const list = byFrame.get(parsed.frameId) ?? [];
      list.push(parsed.localId);
      byFrame.set(parsed.frameId, list);
    }
  }

  const fieldResults: FillFieldResultPayload[] = [];
  for (const [frameId, localIds] of byFrame) {
    if (!localIds.length) continue;
    try {
      const res = (await chrome.tabs.sendMessage(
        tabId,
        { type: "RETRY_FIELDS", ids: localIds, profile, resumeFile },
        { frameId },
      )) as { success?: boolean; fieldResults?: FillFieldResultPayload[] };
      if (res?.success && Array.isArray(res.fieldResults)) {
        fieldResults.push(...mergeFillFieldResults(frameId, res.fieldResults));
      }
    } catch {
      // ignore
    }
  }
  return { success: true, fieldResults };
}

async function undoTabFill(tabId: number) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  let restored = 0;
  for (const { frameId, url } of frames) {
    if (!url || url.startsWith("chrome-extension:")) continue;
    try {
      const res = (await chrome.tabs.sendMessage(tabId, { type: "UNDO_LAST_FILL" }, { frameId })) as {
        restored?: number;
      };
      restored += Number(res?.restored ?? 0);
    } catch {
      // ignore
    }
  }
  return { success: true, restored };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ON_ATS_PAGE") {
    void chrome.action.setBadgeText({ text: "⚡" });
    void chrome.action.setBadgeBackgroundColor({ color: "#E8533A" });
    sendResponse?.({ ok: true });
    return true;
  }

  if (msg.type === "SCAN_TAB_FIELDS") {
    const tabId = (msg as { tabId?: number }).tabId ?? sender.tab?.id;
    if (tabId === undefined) {
      sendResponse({ success: false, error: "No tab id", fields: [], isAtsPage: false });
      return false;
    }
    void scanTabFields(tabId).then(sendResponse);
    return true;
  }

  if (msg.type === "FILL_TAB_STANDARD") {
    const tabId = (msg as { tabId?: number }).tabId ?? sender.tab?.id;
    const profile = (msg as { profile?: unknown }).profile;
    const resumeFile = (msg as { resumeFile?: unknown }).resumeFile;
    if (tabId === undefined) {
      sendResponse({ success: false, error: "No tab id" });
      return false;
    }
    void fillTabStandard(tabId, profile, resumeFile).then(sendResponse);
    return true;
  }

  if (msg.type === "FILL_TAB_AI_ANSWERS") {
    const tabId = (msg as { tabId?: number }).tabId ?? sender.tab?.id;
    const answers = (msg as { answers?: AiAnswerPayload[] }).answers ?? [];
    if (tabId === undefined) {
      sendResponse({ success: false, error: "No tab id" });
      return false;
    }
    void fillTabAiAnswers(tabId, answers).then(sendResponse);
    return true;
  }

  if (msg.type === "RETRY_TAB_FIELDS") {
    const tabId = (msg as { tabId?: number }).tabId ?? sender.tab?.id;
    const ids = (msg as { ids?: string[] }).ids ?? [];
    const profile = (msg as { profile?: unknown }).profile;
    const resumeFile = (msg as { resumeFile?: unknown }).resumeFile;
    if (tabId === undefined) {
      sendResponse({ success: false, error: "No tab id" });
      return false;
    }
    void retryTabFields(tabId, ids, profile, resumeFile).then(sendResponse);
    return true;
  }

  if (msg.type === "UNDO_TAB_FILL") {
    const tabId = (msg as { tabId?: number }).tabId ?? sender.tab?.id;
    if (tabId === undefined) {
      sendResponse({ success: false, error: "No tab id" });
      return false;
    }
    void undoTabFill(tabId).then(sendResponse);
    return true;
  }

  if (msg.type === "API_REQUEST") {
    void (async () => {
      try {
        const req = msg as ApiRequestMessage;
        const storage = await getStorage(["apiBase", "authToken"]);
        const apiBase = (storage.apiBase as string | undefined) ?? DEFAULT_API;
        const authToken = (storage.authToken as string | undefined) ?? null;
        if (req.auth !== false && !authToken) {
          sendResponse({ ok: false, status: 401, error: "Not authenticated" });
          return;
        }
        const headers: Record<string, string> = {
          ...(req.headers ?? {}),
        };
        if (req.auth !== false && authToken) {
          headers.Authorization = `Bearer ${authToken}`;
        }
        const res = await fetch(`${apiBase}${req.path}`, {
          method: req.method ?? "GET",
          headers,
          body: req.body,
        });
        const contentType = res.headers.get("content-type") ?? "";
        const contentDisposition = res.headers.get("content-disposition") ?? "";
        if (req.responseType === "arrayBuffer") {
          const buffer = await res.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = "";
          const chunk = 8192;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
          }
          const dataBase64 = btoa(binary);
          sendResponse({
            ok: res.ok,
            status: res.status,
            dataBase64,
            headers: {
              "content-type": contentType,
              "content-disposition": contentDisposition,
            },
          });
          return;
        }
        if (req.responseType === "text") {
          const text = await res.text();
          sendResponse({
            ok: res.ok,
            status: res.status,
            data: text,
            headers: {
              "content-type": contentType,
              "content-disposition": contentDisposition,
            },
          });
          return;
        }
        const text = await res.text();
        let json: unknown = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            json = { raw: text };
          }
        }
        sendResponse({
          ok: res.ok,
          status: res.status,
          data: json,
          headers: {
            "content-type": contentType,
            "content-disposition": contentDisposition,
          },
        });
      } catch (error) {
        sendResponse({
          ok: false,
          status: 500,
          error: error instanceof Error ? error.message : "Extension API proxy failed",
        });
      }
    })();
    return true;
  }

  return false;
});

chrome.action.onClicked.addListener((tab) => {
  const tabId = tab.id;
  if (tabId === undefined) return;
  void chrome.tabs.sendMessage(tabId, { type: "TOGGLE_SIDEBAR" }, { frameId: 0 });
});

chrome.tabs.onActivated.addListener(() => {
  void chrome.action.setBadgeText({ text: "" });
});
