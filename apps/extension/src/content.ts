import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { detectFormFields } from "./lib/fieldDetector";
import { fillAIAnswersWithFallback, fillStandardFields, undoLastFill } from "./lib/formFiller";
import type { ApplyProfile } from "./lib/formFiller";
import { postSmartApplyEvent } from "./lib/api";
import { SidebarApp } from "./ui/SidebarApp";
import { SIDEBAR_PANEL_WIDTH_PX } from "./ui/uiMotion";
import { getSidebarState, patchSidebarState } from "./ui/store";
import { isLikelyAtsPage } from "./lib/atsDetection";
import { isSmartApplyEligibleSurface } from "./lib/smartApplySurface";

const isTopFrame = window.self === window.top;

/**
 * Content scripts only run where `manifest.json` `content_scripts.matches` allow; that is the
 * career/ATS surface — show floating UI on the top frame without a second hostname heuristic gate.
 */
const showInjectedChrome = isTopFrame;

/** Page-visible beacon lives in presenceBeacon.js (MAIN world); isolated scripts cannot set host globals. */

if (showInjectedChrome) {
  void chrome.runtime.sendMessage({ type: "ON_ATS_PAGE", hostname: window.location.hostname });
  void postSmartApplyEvent("ats_page_detected", {
    hostname: window.location.hostname,
    path: window.location.pathname,
    strictAtsSignals: isLikelyAtsPage(window.location.href),
  });
}

declare global {
  interface Window {
    __JOBSEEK_EXTENSION__?: boolean;
  }
}

function ensureSidebarRoot(): HTMLElement {
  let container = document.getElementById("jobwizard-sidebar-root");
  if (!container) {
    container = document.createElement("div");
    container.id = "jobwizard-sidebar-root";
  }
  const html = document.documentElement;
  if (container.parentElement !== html || html.lastElementChild !== container) {
    html.appendChild(container);
  }
  Object.assign(container.style, {
    position: "fixed",
    top: "0",
    right: "0",
    left: "auto",
    bottom: "auto",
    width: `${SIDEBAR_PANEL_WIDTH_PX}px`,
    height: "100vh",
    zIndex: "2147483647",
    pointerEvents: "none",
    isolation: "isolate",
    overflow: "visible",
  });
  let mount =
    container.querySelector<HTMLElement>("#jobwizard-sidebar-mount") ??
    container.shadowRoot?.querySelector<HTMLElement>("#jobwizard-sidebar-mount");
  if (!mount) {
    mount = document.createElement("div");
    mount.id = "jobwizard-sidebar-mount";
    mount.style.pointerEvents = "auto";
    let shadow: ShadowRoot | null = null;
    try {
      shadow = container.shadowRoot ?? container.attachShadow?.({ mode: "open" }) ?? null;
    } catch {
      shadow = null;
    }
    if (shadow) {
      const reset = document.createElement("style");
      /** System font stacks only in UI components — no third-party font requests. */
      reset.textContent = `
        :host { all: initial; }
        *, *::before, *::after { box-sizing: border-box; }
      `;
      shadow.appendChild(reset);
      shadow.appendChild(mount);
    } else {
      container.appendChild(mount);
    }
  }
  return mount;
}

let sidebarReactRoot: Root | null = null;
let sidebarMountEl: HTMLElement | null = null;

function mountSidebarApp(): void {
  const mount = ensureSidebarRoot();
  if (sidebarMountEl === mount && sidebarReactRoot && mount.isConnected) return;

  if (sidebarReactRoot) {
    try {
      sidebarReactRoot.unmount();
    } catch {
      /* root may already be torn down */
    }
    sidebarReactRoot = null;
    sidebarMountEl = null;
  }

  sidebarMountEl = mount;
  sidebarReactRoot = createRoot(mount);
  /** Sync store before first React paint so SidebarApp does not briefly `return null`. */
  patchSidebarState({ isVisible: true, atsDetected: true });
  sidebarReactRoot.render(createElement(SidebarApp, { isAtsPage: true }));
}

function reconcileSidebarMount(): void {
  const mount = ensureSidebarRoot();
  if (!mount.isConnected || sidebarMountEl !== mount || !sidebarReactRoot) {
    mountSidebarApp();
  }
}

/**
 * SPAs (e.g. Greenhouse) may replace `<html>`/`MutationObserver` targets entirely — observers then
 * watch detached nodes and never fire again. Combine `document` observation, periodic reconcile,
 * and keeping our host last under `<html>` for stacking.
 */
function ensureSidebarSurvivesDomChurn(): void {
  let debounceTimer: number | undefined;

  const schedule = () => {
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = undefined;
      window.requestAnimationFrame(() => reconcileSidebarMount());
    }, 60);
  };

  const mo = new MutationObserver(schedule);

  function bindMutationObservers(): void {
    mo.disconnect();
    try {
      mo.observe(document, { childList: true });
    } catch {
      /* Document observation unsupported — polling still runs */
    }
    const html = document.documentElement;
    if (html) mo.observe(html, { childList: true });
    const body = document.body;
    if (body) mo.observe(body, { childList: true });
  }

  bindMutationObservers();

  window.addEventListener(
    "pageshow",
    () => {
      bindMutationObservers();
      schedule();
    },
    { passive: true },
  );

  document.addEventListener("visibilitychange", schedule, { passive: true });

  window.setInterval(() => {
    if (document.visibilityState === "visible") {
      window.requestAnimationFrame(() => reconcileSidebarMount());
    }
  }, 400);
}

if (showInjectedChrome) {
  mountSidebarApp();
  ensureSidebarSurvivesDomChurn();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const replyError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown extension error";
    sendResponse({ success: false, error: message });
  };

  if (msg.type === "SCAN_FIELDS") {
    try {
      const fields = detectFormFields();
      sendResponse({
        success: true,
        fields,
        isAtsPage: isSmartApplyEligibleSurface(window.location.href),
      });
    } catch (error) {
      replyError(error);
    }
    return false;
  }

  if (msg.type === "FILL_STANDARD") {
    void (async () => {
      try {
        const result = await fillStandardFields(detectFormFields(), msg.profile as ApplyProfile, {
          resumeFile: msg.resumeFile ?? null,
        });
        sendResponse({ success: true, ...result });
      } catch (error) {
        replyError(error);
      }
    })();
    return true;
  }

  if (msg.type === "RETRY_FIELDS") {
    const all = detectFormFields();
    const ids = new Set(Array.isArray(msg.ids) ? (msg.ids as string[]) : []);
    const target = all.filter((f) => ids.has(f.id));
    void (async () => {
      try {
        const result = await fillStandardFields(target, msg.profile as ApplyProfile, {
          resumeFile: msg.resumeFile ?? null,
        });
        sendResponse({ success: true, ...result });
      } catch (error) {
        replyError(error);
      }
    })();
    return true;
  }

  if (msg.type === "FILL_AI_ANSWERS") {
    void (async () => {
      try {
        const fields = detectFormFields();
        const result = await fillAIAnswersWithFallback(
          msg.answers as Array<{
            id: string;
            answer: string;
            question?: string;
            selector?: string;
            questionHash?: string;
            groupKey?: string;
            forceReplace?: boolean;
          }>,
          fields,
        );
        sendResponse({ success: true, ...result });
      } catch (error) {
        replyError(error);
      }
    })();
    return true;
  }

  if (msg.type === "UNDO_LAST_FILL") {
    void (async () => {
      try {
        const result = await undoLastFill();
        sendResponse({ success: true, ...result });
      } catch (error) {
        replyError(error);
      }
    })();
    return true;
  }

  if (msg.type === "TOGGLE_SIDEBAR") {
    if (!isTopFrame) {
      sendResponse({ success: false, error: "Sidebar runs in main frame only" });
      return false;
    }
    const current = getSidebarState();
    patchSidebarState({ isOpen: !current.isOpen, isVisible: true, atsDetected: true });
    sendResponse({ success: true, isOpen: !current.isOpen });
    return false;
  }

  return false;
});
