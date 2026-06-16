import { isAllowedApiPath } from "./allowedApiPaths";
import {
  getDefaultApiBase,
  isLoopbackHttpUrl,
  isProductionExtensionBuild,
  resolveApiBaseFromStorage,
} from "../config";

export type ExtensionApiProxyResponse<T = unknown> = {
  ok: boolean;
  status: number;
  data?: T;
  dataBase64?: string;
  error?: string;
  headers?: Record<string, string>;
};

async function getStorage(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result as Record<string, unknown>));
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Shared fetch logic for background proxy and content-script direct fallback. */
export async function executeAllowedApiRequest<T = unknown>(params: {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  auth?: boolean;
  responseType?: "json" | "text" | "arrayBuffer";
}): Promise<ExtensionApiProxyResponse<T>> {
  if (!isAllowedApiPath(params.path)) {
    return { ok: false, status: 0, error: "Invalid API path" };
  }

  const storage = await getStorage(["apiBase", "authToken"]);
  const apiBase = resolveApiBaseFromStorage(
    storage.apiBase as string | undefined,
    getDefaultApiBase(),
  );
  const baseTrim = apiBase.replace(/\/+$/, "");
  let requestUrl: string;
  let u: URL;
  try {
    const baseUrl = new URL(baseTrim);
    u = new URL(params.path, baseUrl);
    if (u.origin !== baseUrl.origin) {
      return { ok: false, status: 0, error: "Invalid API URL" };
    }
    requestUrl = u.toString();
  } catch {
    return { ok: false, status: 0, error: "Invalid API URL" };
  }

  const canFetch =
    u.protocol === "https:" ||
    isLoopbackHttpUrl(u) ||
    (u.protocol === "http:" && !isProductionExtensionBuild());
  if (!canFetch) {
    return { ok: false, status: 0, error: "API requests must use HTTPS" };
  }

  const authToken = (storage.authToken as string | undefined) ?? null;
  if (params.auth !== false && !authToken) {
    return { ok: false, status: 401, error: "Not authenticated" };
  }

  const headers: Record<string, string> = { ...(params.headers ?? {}) };
  if (params.auth !== false && authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  try {
    const res = await fetch(requestUrl, {
      method: params.method ?? "GET",
      headers,
      body: params.body,
    });
    const contentType = res.headers.get("content-type") ?? "";
    const contentDisposition = res.headers.get("content-disposition") ?? "";
    const responseHeaders = {
      "content-type": contentType,
      "content-disposition": contentDisposition,
    };

    if (params.responseType === "arrayBuffer") {
      const buffer = await res.arrayBuffer();
      return {
        ok: res.ok,
        status: res.status,
        dataBase64: arrayBufferToBase64(buffer),
        headers: responseHeaders,
      };
    }

    if (params.responseType === "text") {
      const text = await res.text();
      return {
        ok: res.ok,
        status: res.status,
        data: text as T,
        headers: responseHeaders,
      };
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
    return {
      ok: res.ok,
      status: res.status,
      data: json as T,
      headers: responseHeaders,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "API request failed",
    };
  }
}
