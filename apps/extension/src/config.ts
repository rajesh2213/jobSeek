/** Build-time default API origin (injected by webpack). */
declare const __EXTENSION_API_BASE__: string;
declare const __EXT_PROD__: string;

const fallback = "https://jobseek-server.up.railway.app";

export function getDefaultApiBase(): string {
  if (typeof __EXTENSION_API_BASE__ === "string" && __EXTENSION_API_BASE__) {
    return __EXTENSION_API_BASE__.replace(/\/+$/, "");
  }
  return fallback;
}

export function isProductionExtensionBuild(): boolean {
  return typeof __EXT_PROD__ === "string" && __EXT_PROD__ === "true";
}

/**
 * Resolves which API base URL to use. In production store builds, only `https` origins
 * are allowed; invalid values fall back to the default.
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
    if (isProductionExtensionBuild()) {
      return def;
    }
    return t.replace(/\/+$/, "");
  }
  return def;
}
