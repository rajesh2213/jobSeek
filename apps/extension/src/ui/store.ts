import type { SmartApplyStatusSnapshot } from "../lib/api";
import type { ApplyProfile, ResumeFilePayload } from "../lib/formFiller";
import type { DetectedField } from "../lib/fieldDetector";

export type FieldState = {
  id: string;
  label: string;
  selector: string;
  frameId?: number;
  groupKey?: string;
  inputType?: string;
  status:
    | "idle"
    | "queued"
    | "loading"
    | "ai_generating"
    | "filled"
    | "failed"
    | "skipped"
    | "manual_required";
  source?: "mapping" | "ai" | "fallback";
  isOpenEnded?: boolean;
  reason?: string;
};

export type SidebarState = {
  isOpen: boolean;
  isVisible: boolean;
  isRunning: boolean;
  atsDetected: boolean;
  fields: FieldState[];
  detectedFields: DetectedField[];
  profile: ApplyProfile | null;
  /** Loaded from GET `/account/smart-apply/status` when opening ATS sidebar. */
  smartApplyStatus: SmartApplyStatusSnapshot | null;
  /** `null` until `chrome.storage.local` is read (`authToken`). */
  hasAuthToken: boolean | null;
  /** `true` after the first profile + status fetch for this ATS session finishes. */
  accountDataLoaded: boolean;
  /** Last profile/status HTTP diagnostic when token exists but API data is missing. */
  accountSyncHint: string | null;
  resumeFile: ResumeFilePayload | null;
  progress: { completed: number; total: number };
  error: string | null;
  selectedFieldId: string | null;
};

type Listener = () => void;

function cleanFieldLabel(raw: string): string {
  const stripped = raw
    .replace(/\b[0-9a-f]{8}\s+[0-9a-f]{4}\s+[0-9a-f]{4}\s+[0-9a-f]{4}\s+[0-9a-f]{12}\b/gi, " ")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, " ")
    .replace(/hello@example\.com\.\.\./gi, " ")
    .replace(/type here\.\.\./gi, " ")
    .replace(/systemfield/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "";
  const words = stripped.split(" ");
  const deduped: string[] = [];
  for (const word of words) {
    if (deduped[deduped.length - 1]?.toLowerCase() === word.toLowerCase()) continue;
    deduped.push(word);
  }
  return deduped.join(" ").trim();
}

/** Sidebar row title — exported for AI prompts so wording matches the field list. */
export function pickDetectedFieldLabel(field: DetectedField): string {
  const gl = cleanFieldLabel(field.groupLabel ?? "");
  const qt = cleanFieldLabel(field.questionText ?? "");
  const lb = cleanFieldLabel(field.label ?? "");

  // Hear-about options are often per-choice labels ("LinkedIn"); prefer the real question text.
  if (field.fieldType === "hearAbout") {
    const questionLike = [gl, qt].find(
      (v) =>
        /\b(hear about|how did you hear|where did you hear|opportunity|select all)\b/i.test(v) ||
        v.includes("?"),
    );
    if (questionLike) return questionLike.slice(0, 220);
    const longest = [gl, qt, lb].filter(Boolean).sort((a, b) => b.length - a.length)[0];
    return longest ?? "How did you hear about this role?";
  }

  // Radio/checkbox groups: avoid showing only the short option text when we have a longer prompt.
  if (field.groupKey && (field.inputType === "radio" || field.inputType === "checkbox")) {
    const groupPrompt = [gl, qt].find(
      (v) => v.length > 40 || /\?/.test(v) || /\b(select one|select all|choose)\b/i.test(v),
    );
    if (groupPrompt) return groupPrompt.slice(0, 220);
  }

  const candidates = [gl, qt, lb].filter(Boolean).sort((a, b) => a.length - b.length);
  return candidates[0] ?? "Field";
}

const state: SidebarState = {
  isOpen: false,
  isVisible: false,
  isRunning: false,
  atsDetected: false,
  fields: [],
  detectedFields: [],
  profile: null,
  smartApplyStatus: null,
  hasAuthToken: null,
  accountDataLoaded: false,
  accountSyncHint: null,
  resumeFile: null,
  progress: { completed: 0, total: 0 },
  error: null,
  selectedFieldId: null,
};

const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

export function getSidebarState(): SidebarState {
  return state;
}

export function subscribeSidebarState(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function patchSidebarState(patch: Partial<SidebarState>): void {
  Object.assign(state, patch);
  emit();
}

export function setDetectedFields(fields: DetectedField[]): void {
  const byId = new Map(state.fields.map((row) => [row.id, row]));
  const bySelector = new Map(state.fields.map((row) => [row.selector, row]));
  state.detectedFields = fields;
  state.fields = fields.map((field) => ({
    ...(byId.get(field.id) ?? bySelector.get(field.elementSelector) ?? {
      id: field.id,
      status: "idle" as const,
      source: undefined,
      reason: undefined,
    }),
    id: field.id,
    label: pickDetectedFieldLabel(field),
    selector: field.elementSelector,
    frameId: field.frameId,
    groupKey: field.groupKey,
    inputType: field.inputType,
    isOpenEnded: field.isOpenEnded,
  }));
  const completed = state.fields.filter(
    (field) =>
      field.status === "filled" ||
      field.status === "failed" ||
      field.status === "skipped" ||
      field.status === "manual_required",
  ).length;
  state.progress = { completed, total: fields.length };
  state.selectedFieldId = null;
  emit();
}

export function resetFieldStates(): void {
  state.fields = state.fields.map((field) => ({
    ...field,
    status: "idle",
    source: undefined,
    reason: undefined,
  }));
  state.progress = { completed: 0, total: state.fields.length };
  emit();
}

export function updateFieldState(
  id: string,
  patch: Partial<Omit<FieldState, "id">>,
): void {
  const row = state.fields.find((field) => field.id === id);
  if (!row) return;
  Object.assign(row, patch);
  emit();
}

