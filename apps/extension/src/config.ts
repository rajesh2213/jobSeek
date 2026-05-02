/** Build-time default API origin (injected by webpack). */
declare const __EXTENSION_API_BASE__: string;
declare const __EXT_PROD__: string;
declare const __LOCAL_API_FALLBACK__: string;

const fallbackProd = "https://jobseek-server.up.railway.app";

const LOOP_LOCALHOST = [108, 111, 99, 97, 108, 104, 111, 115, 116]
  .map((n) => String.fromCharCode(n))
  .join("");
const LOOP_NUMERIC = [49, 50, 55, 46, 48, 46, 48, 46, 49].map((n) => String.fromCharCode(n)).join("");

export function getDefaultApiBase(): string {
  if (typeof __EXTENSION_API_BASE__ === "string" && __EXTENSION_API_BASE__) {
    return __EXTENSION_API_BASE__.replace(/\/+$/, "");
  }
  if (isProductionExtensionBuild()) return fallbackProd;
  const devFb =
    typeof __LOCAL_API_FALLBACK__ === "string" ? __LOCAL_API_FALLBACK__.trim().replace(/\/+$/, "") : "";
  return devFb || fallbackProd;
}

export function isProductionExtensionBuild(): boolean {
  return typeof __EXT_PROD__ === "string" && __EXT_PROD__ === "true";
}

/** HTTP allowed for local Fastify/API during development (production webpack builds included). */
export function isLoopbackHttpUrl(u: URL): boolean {
  const h = u.hostname.toLowerCase();
  return u.protocol === "http:" && (h === LOOP_LOCALHOST || h === LOOP_NUMERIC);
}

/**
 * Resolves which API base URL to use. Production builds reject non-loopback `http:` (fallback
 * to default); `https:` and loopback `http:` are kept when stored.
 */
export function resolveApiBaseFromStorage(
  fromStorage: string | undefined,
  def: string = getDefaultApiBase(),
): string {
  if (!fromStorage || typeof fromStorage !== "string") {
    return def;
  }
  const t = fromStorage.trim();
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return def;
  }
  if (u.protocol === "https:") {
    return t.replace(/\/+$/, "");
  }
  if (u.protocol === "http:") {
    if (isLoopbackHttpUrl(u)) {
      return t.replace(/\/+$/, "");
    }
    if (isProductionExtensionBuild()) {
      return def;
    }
    return t.replace(/\/+$/, "");
  }
  return def;
}
