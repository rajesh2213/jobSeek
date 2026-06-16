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
export async function scanAllPageFields(sendRuntime: RuntimeMessenger): Promise<DetectedField[]> {
  const topFields = scanTopFrameFields(0);
  try {
    const tabId = await getCurrentTabId();
    const res = await sendRuntime<ScanTabFieldsResponse>({
      type: "SCAN_TAB_FIELDS",
      tabId,
      skipFrameIds: [0],
    });
    const subFrames =
      res?.success !== false && Array.isArray(res.fields) ? res.fields : [];
    return [...topFields, ...subFrames];
  } catch {
    return topFields;
  }
}
