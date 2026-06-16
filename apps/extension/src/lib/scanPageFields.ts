import { detectFormFields, type DetectedField } from "./fieldDetector";
import { compositeFieldId } from "./frameIds";

/** Scan the current frame directly (no background round-trip). */
export function scanTopFrameFields(frameId = 0): DetectedField[] {
  return detectFormFields().map((field) => ({
    ...field,
    localId: field.id,
    frameId,
    id: compositeFieldId(frameId, field.id),
  }));
}

async function scanTopFrameFieldsWithReveal(frameId = 0): Promise<DetectedField[]> {
  const bySelector = new Map<string, DetectedField>();
  const snap = () => {
    for (const field of detectFormFields()) {
      const row: DetectedField = {
        ...field,
        localId: field.id,
        frameId,
        id: compositeFieldId(frameId, field.id),
      };
      bySelector.set(row.elementSelector, row);
    }
  };

  snap();
  const root = document.scrollingElement ?? document.documentElement;
  const startY = root.scrollTop;
  const maxY = Math.max(0, root.scrollHeight - window.innerHeight);
  if (maxY > 80) {
    const stops = [0.5, 1].map((p) => Math.round(maxY * p));
    for (const y of stops) {
      root.scrollTo({ top: y, behavior: "instant" });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
      snap();
    }
    root.scrollTo({ top: startY, behavior: "instant" });
  }
  return Array.from(bySelector.values());
}

type ScanTabFieldsResponse = {
  success?: boolean;
  fields?: DetectedField[];
  error?: string;
};

type RuntimeMessenger = <T>(msg: object) => Promise<T>;

function getCurrentTabId(): Promise<number | undefined> {
  return new Promise((resolve) => {
    if (!chrome.tabs?.getCurrent) {
      resolve(undefined);
      return;
    }
    chrome.tabs.getCurrent((tab) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }
      resolve(tab?.id);
    });
  });
}

/**
 * Scan application fields on the active tab. The top frame is scanned in-process
 * because a content-script → background → same content-script `SCAN_FIELDS` loop
 * can deadlock and return zero fields on ATS pages (e.g. Ashby).
 */
export async function scanAllPageFields(
  sendRuntime: RuntimeMessenger,
  options?: { revealHidden?: boolean },
): Promise<DetectedField[]> {
  const topFields = options?.revealHidden
    ? await scanTopFrameFieldsWithReveal(0)
    : scanTopFrameFields(0);
  try {
    const tabId = await getCurrentTabId();
    const timeoutMs = 2500;
    const timeoutRes = new Promise<ScanTabFieldsResponse | null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    });

    const res = await Promise.race([
      sendRuntime<ScanTabFieldsResponse>({
        type: "SCAN_TAB_FIELDS",
        tabId,
        skipFrameIds: [0],
      }),
      timeoutRes,
    ]);

    if (!res) return topFields;

    const subFrames =
      res.success !== false && Array.isArray(res.fields) ? res.fields : [];
    return [...topFields, ...subFrames];
  } catch {
    return topFields;
  }
}
