import { resolveJobloomExtensionId } from "./jobloomExtensionId";
import {
  isJobloomWebOrigin,
  postAuthTokenToInstalledExtension,
  postClearAuthToInstalledExtension,
} from "./extensionContentBridge";

export type ExtensionAuthAck = { ok?: boolean; error?: string };

/** Chrome extension ID used for `sendMessage` auth sync (matches published listing by default). */
export function getJobloomExtensionId(): string {
  return resolveJobloomExtensionId();
}

/** Web origins matching JobLoom Smart Apply `externally_connectable` may expose `chrome.runtime.sendMessage`. */
export function extensionBridgeAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const win = window as Window & {
    chrome?: { runtime?: { sendMessage?: unknown } };
  };
  return typeof win.chrome?.runtime?.sendMessage === "function";
}

function sendToExtension(extensionId: string, message: unknown): Promise<ExtensionAuthAck | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(null);
      return;
    }
    const win = window as Window & {
      chrome?: {
        runtime?: {
          sendMessage?: (
            extensionIdArg: string,
            msg: unknown,
            cb?: (response: ExtensionAuthAck) => void,
          ) => void;
          lastError?: { message?: string };
        };
      };
    };
    const runtime = win.chrome?.runtime;
    const sendMessage = runtime?.sendMessage;
    if (typeof sendMessage !== "function") {
      resolve(null);
      return;
    }
    try {
      sendMessage(extensionId, message, (response: ExtensionAuthAck) => {
        const err = runtime?.lastError;
        if (err?.message) {
          resolve(null);
          return;
        }
        resolve(response ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** Push Clerk session JWT into the extension (`chrome.storage.local.authToken`). */
export async function syncExtensionAuthToken(
  getToken: () => Promise<string | null>,
): Promise<boolean> {
  const extId = getJobloomExtensionId();
  if (!extensionBridgeAvailable()) return false;
  const token = await getToken();
  if (!token) return false;
  postAuthTokenToInstalledExtension(token);
  const res = await sendToExtension(extId, { type: "SET_AUTH_TOKEN", token });
  if (res?.ok === true) return true;
  /** Content-script bridge on JobLoom tabs stores the token for whichever extension is installed. */
  return typeof window !== "undefined" && isJobloomWebOrigin(window.location.origin);
}

export async function clearExtensionAuth(): Promise<void> {
  postClearAuthToInstalledExtension();
  if (!extensionBridgeAvailable()) return;
  await sendToExtension(getJobloomExtensionId(), { type: "CLEAR_AUTH_TOKEN" });
}

/** Detect install + manifest allowlist without writing storage. */
export async function pingExtension(): Promise<boolean> {
  if (!extensionBridgeAvailable()) return false;
  const res = await sendToExtension(getJobloomExtensionId(), { type: "PING" });
  return res?.ok === true;
}
