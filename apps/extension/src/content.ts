import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { detectFormFields } from "./lib/fieldDetector";
import { fillAIAnswersWithFallback, fillStandardFields, undoLastFill } from "./lib/formFiller";
import type { ApplyProfile } from "./lib/formFiller";
import { postSmartApplyEvent } from "./lib/api";
import { SidebarApp } from "./ui/SidebarApp";
import { getSidebarState, patchSidebarState } from "./ui/store";
import { isLikelyAtsPage } from "./lib/atsDetection";

const isTopFrame = window.self === window.top;
const isAtsPage = isLikelyAtsPage(window.location.href);

(window as Window & { __JOBSEEK_EXTENSION__?: boolean }).__JOBSEEK_EXTENSION__ = true;
window.dispatchEvent(new Event("jobseek-extension-ready"));

if (isTopFrame && isAtsPage) {
  void chrome.runtime.sendMessage({ type: "ON_ATS_PAGE", hostname: window.location.hostname });
  void postSmartApplyEvent("ats_page_detected", {
    hostname: window.location.hostname,
    path: window.location.pathname,
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
  if (container.parentElement !== document.documentElement) {
    document.documentElement.appendChild(container);
  }
  Object.assign(container.style, {
    position: "fixed",
    top: "0",
    right: "0",
    left: "auto",
    bottom: "auto",
    width: "420px",
    height: "100vh",
    zIndex: "2147483647",
    pointerEvents: "none",
    isolation: "isolate",
    overflow: "visible",
  });
  let mount = container.querySelector<HTMLElement>("#jobwizard-sidebar-mount");
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
      reset.textContent = `
        @import url("https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap");
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

if (isTopFrame && isAtsPage) {
  const root = ensureSidebarRoot();
  createRoot(root).render(createElement(SidebarApp, { isAtsPage }));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const replyError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown extension error";
    sendResponse({ success: false, error: message });
  };

  if (msg.type === "SCAN_FIELDS") {
    try {
      const fields = detectFormFields();
      sendResponse({ success: true, fields, isAtsPage });
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
    if (!isAtsPage) {
      sendResponse({ success: false, error: "Not an ATS page" });
      return false;
    }
    const current = getSidebarState();
    patchSidebarState({ isOpen: !current.isOpen, isVisible: true, atsDetected: true });
    sendResponse({ success: true, isOpen: !current.isOpen });
    return false;
  }

  return false;
});
