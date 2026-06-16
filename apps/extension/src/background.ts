import { compositeFieldId, parseCompositeFieldId } from "./lib/frameIds";
import { OPTIONAL_GENERIC_CAREER_ORIGINS, matchesOptionalGenericCareerPath } from "./lib/careerPathPatterns";
import { syncOptionalCareerContentScripts } from "./lib/optionalCareerScripts";
import { isSmartApplyEligibleSurface } from "./lib/smartApplySurface";
import { executeAllowedApiRequest } from "./lib/extensionApiRequest";
import { isProductionExtensionBuild } from "./config";
import { isTrustedExtensionWebOrigin } from "./trustedWebOrigins";

const EXT_AUTH_TOKEN_MAX_CHARS = 16_384;

function senderOrigin(sender: chrome.runtime.MessageSender): string | null {
  const parseOrigin = (raw: string | undefined): string | null => {
    if (!raw || typeof raw !== "string") return null;
    try {
      return new URL(raw).origin;
    } catch {
      return null;
    }
  };
  /** Prefer `origin` — Chrome documents it for sender trust when `url` is missing or opaque (e.g. some external webpage sends). */
  return parseOrigin(sender.origin) ?? parseOrigin(sender.url);
}

function looseJwtShape(token: string): boolean {
  const parts = token.split(".");
  return parts.length >= 3 && parts.every((p) => p.length > 0);
}

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

async function scanTabFields(tabId: number, options?: { skipFrameIds?: number[] }) {
  const skipFrameIds = new Set(options?.skipFrameIds ?? []);
  // Yield so a content-script caller waiting on SCAN_TAB_FIELDS can handle per-frame SCAN_FIELDS.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

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
    if (skipFrameIds.has(frameId)) continue;
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
  let optionalCareerGranted = false;
  try {
    optionalCareerGranted = await chrome.permissions.contains({
      origins: [...OPTIONAL_GENERIC_CAREER_ORIGINS],
    });
  } catch {
    optionalCareerGranted = false;
  }
  const isAtsPage =
    isSmartApplyEligibleSurface(tabUrl) ||
    (optionalCareerGranted && matchesOptionalGenericCareerPath(tabUrl));
  return { success: true as const, fields: merged, isAtsPage, tabUrl };
}

async function fillTabStandard(
  tabId: number,
  profile: unknown,
  resumeFile: unknown,
  options?: { skipFrameIds?: number[] },
): Promise<Record<string, unknown>> {
  const skipFrameIds = new Set(options?.skipFrameIds ?? []);
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const fieldResults: FillFieldResultPayload[] = [];
  const openEnded: DetectedFieldPayload[] = [];
  const filled: string[] = [];
  const skipped: string[] = [];
  let resumeAttached = false;

  for (const { frameId, url } of frames) {
    if (skipFrameIds.has(frameId)) continue;
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
  forceReplace?: boolean;
};

async function fillTabAiAnswers(
  tabId: number,
  answers: AiAnswerPayload[],
  options?: { skipFrameIds?: number[] },
) {
  const skipFrameIds = new Set(options?.skipFrameIds ?? []);
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
    if (skipFrameIds.has(frameId)) continue;
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
    const skipFrameIdsFromMsg = (msg as { skipFrameIds?: number[] }).skipFrameIds ?? [];
    const callerFrameId = (sender as chrome.runtime.MessageSender & { frameId?: number }).frameId;
    const skipFrameIds = Array.from(
      new Set([
        ...(typeof callerFrameId === "number" ? [callerFrameId] : []),
        ...skipFrameIdsFromMsg,
      ]),
    );
    if (tabId === undefined) {
      sendResponse({ success: false, error: "No tab id", fields: [], isAtsPage: false });
      return false;
    }
    void scanTabFields(tabId, { skipFrameIds }).then(sendResponse);
    return true;
  }

  if (msg.type === "FILL_TAB_STANDARD") {
    const tabId = (msg as { tabId?: number }).tabId ?? sender.tab?.id;
    const profile = (msg as { profile?: unknown }).profile;
    const resumeFile = (msg as { resumeFile?: unknown }).resumeFile;
    const skipFrameIds = (msg as { skipFrameIds?: number[] }).skipFrameIds ?? [];
    if (tabId === undefined) {
      sendResponse({ success: false, error: "No tab id" });
      return false;
    }
    void fillTabStandard(tabId, profile, resumeFile, { skipFrameIds }).then(sendResponse);
    return true;
  }

  if (msg.type === "FILL_TAB_AI_ANSWERS") {
    const tabId = (msg as { tabId?: number }).tabId ?? sender.tab?.id;
    const answers = (msg as { answers?: AiAnswerPayload[] }).answers ?? [];
    const skipFrameIds = (msg as { skipFrameIds?: number[] }).skipFrameIds ?? [];
    if (tabId === undefined) {
      sendResponse({ success: false, error: "No tab id" });
      return false;
    }
    void fillTabAiAnswers(tabId, answers, { skipFrameIds }).then(sendResponse);
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
    void executeAllowedApiRequest(msg as ApiRequestMessage).then(sendResponse);
    return true;
  }

  return false;
});

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  const origin = senderOrigin(sender);
  if (!origin || !isTrustedExtensionWebOrigin(origin)) {
    sendResponse({ ok: false, error: "Forbidden origin" });
    return false;
  }

  const m = msg as { type?: unknown; token?: unknown };
  const type = typeof m.type === "string" ? m.type : "";

  if (type === "PING") {
    sendResponse({ ok: true });
    return false;
  }

  if (type === "CLEAR_AUTH_TOKEN") {
    void chrome.storage.local.remove(["authToken"], () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (type === "SET_AUTH_TOKEN") {
    if (typeof m.token !== "string") {
      sendResponse({ ok: false, error: "Invalid token" });
      return false;
    }
    const token = m.token.trim();
    if (!token) {
      void chrome.storage.local.remove(["authToken"], () => {
        sendResponse({ ok: true });
      });
      return true;
    }
    if (token.length > EXT_AUTH_TOKEN_MAX_CHARS || !looseJwtShape(token)) {
      sendResponse({ ok: false, error: "Invalid token" });
      return false;
    }
    void chrome.storage.local.set({ authToken: token }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  sendResponse({ ok: false, error: "Unknown message" });
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

chrome.runtime.onInstalled.addListener(() => {
  void syncOptionalCareerContentScripts();
  if (isProductionExtensionBuild()) {
    void chrome.storage.local.remove(["apiBase"]);
  }
});
chrome.permissions.onAdded.addListener(() => void syncOptionalCareerContentScripts());
chrome.permissions.onRemoved.addListener(() => void syncOptionalCareerContentScripts());
