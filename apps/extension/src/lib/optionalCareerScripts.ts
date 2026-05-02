import { OPTIONAL_GENERIC_CAREER_ORIGINS } from "./careerPathPatterns";

const REGISTERED_IDS = ["jobloom-opt-presence", "jobloom-opt-content"] as const;

/**
 * Keeps programmatic matches in sync with optional_host_permissions grants.
 */
export async function syncOptionalCareerContentScripts(): Promise<void> {
  let granted = false;
  try {
    granted = await chrome.permissions.contains({
      origins: [...OPTIONAL_GENERIC_CAREER_ORIGINS],
    });
  } catch {
    granted = false;
  }

  try {
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const removeIds = registered.map((r) => r.id).filter((id) => REGISTERED_IDS.includes(id));
    if (removeIds.length) {
      await chrome.scripting.unregisterContentScripts({ ids: removeIds });
    }
  } catch {
    /* noop */
  }

  if (!granted) return;

  await chrome.scripting.registerContentScripts([
    {
      id: REGISTERED_IDS[0],
      matches: [...OPTIONAL_GENERIC_CAREER_ORIGINS],
      js: ["presenceBeacon.js"],
      runAt: "document_start",
      world: "MAIN",
      allFrames: true,
    },
    {
      id: REGISTERED_IDS[1],
      matches: [...OPTIONAL_GENERIC_CAREER_ORIGINS],
      js: ["content.js"],
      runAt: "document_idle",
      allFrames: true,
    },
  ]);
}
