/** Build-time default API origin (injected by webpack). */
declare const __EXTENSION_API_BASE__: string;
declare const __EXT_PROD__: string;

const fallbackProd = "https://jobseek-server.up.railway.app";

export function getDefaultApiBase(): string {
  if (typeof __EXTENSION_API_BASE__ === "string" && __EXTENSION_API_BASE__) {
    return __EXTENSION_API_BASE__.replace(/\/+$/, "");
  }
  return isProductionExtensionBuild() ? fallbackProd : "http://localhost:3000";
}

export function isProductionExtensionBuild(): boolean {
  return typeof __EXT_PROD__ === "string" && __EXT_PROD__ === "true";
}

/** HTTP allowed for local Fastify/API during development (production webpack builds included). */
export function isLoopbackHttpUrl(u: URL): boolean {
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
}

/**
 * Resolves which API base URL to use. Production builds reject non-loopback `http:` (fallback
 * to default); `https:` and `http://localhost|127.0.0.1` are kept when stored.
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
