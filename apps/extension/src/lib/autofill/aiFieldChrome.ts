const STYLE_ID = "jobloom-ai-field-style";
const ACTIVE = new Map<string, HTMLElement>();

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
@keyframes jobloom-ai-border-pulse {
  0%, 100% {
    box-shadow: 0 0 0 2px rgba(232, 83, 58, 0.45), 0 0 14px rgba(232, 83, 58, 0.18);
    border-color: rgba(232, 83, 58, 0.85) !important;
  }
  50% {
    box-shadow: 0 0 0 3px rgba(232, 83, 58, 0.75), 0 0 22px rgba(232, 83, 58, 0.32);
    border-color: rgba(255, 120, 80, 1) !important;
  }
}
.jobloom-ai-field-active {
  animation: jobloom-ai-border-pulse 1.15s ease-in-out infinite !important;
  outline: none !important;
  border-radius: 8px !important;
  transition: box-shadow 160ms ease, border-color 160ms ease !important;
}
`;
  document.head.appendChild(style);
}

function resolveFieldSurface(selector: string): HTMLElement | null {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return null;
  if (el.getAttribute("contenteditable") === "true") return el;
  const rich = el.parentElement?.querySelector<HTMLElement>('[contenteditable="true"]');
  if (rich) {
    const r = rich.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    const near = !(r.bottom < c.top - 80 || r.top > c.bottom + 80);
    if (near && r.width > 40 && r.height > 16) return rich;
  }
  return el;
}

export function setAiFieldGenerating(selector: string, generating: boolean): void {
  if (!selector) return;
  ensureStyle();
  if (!generating) {
    const prev = ACTIVE.get(selector);
    if (prev) {
      prev.classList.remove("jobloom-ai-field-active");
      ACTIVE.delete(selector);
    }
    return;
  }
  const surface = resolveFieldSurface(selector);
  if (!surface) return;
  ACTIVE.set(selector, surface);
  surface.classList.add("jobloom-ai-field-active");
}

export function clearAllAiFieldChrome(): void {
  for (const selector of Array.from(ACTIVE.keys())) {
    setAiFieldGenerating(selector, false);
  }
}
