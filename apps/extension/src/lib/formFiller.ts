import type { DetectedField } from "./fieldDetector";
import { mapDeterministicValue } from "./autofill/mapping";
import { extractIntent } from "./autofill/intent";
import { resolveFactualField } from "./autofill/factualResolver";

export interface ApplyProfile {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  currentTitle?: string;
  currentCompany?: string;
  yearsOfExperience?: number;
  workAuthorization?: string;
  salaryExpectation?: string;
  availableFrom?: string;
  pronouns?: string;
  hearAbout?: string;
  /** From GET /account/apply-profile — true if resume text or file bytes exist. */
  hasResume?: boolean;
}

export interface ResumeFilePayload {
  fileName: string;
  contentType: string;
  bytes: ArrayBuffer;
}

export type FillFieldStatus = "filled" | "skipped" | "failed" | "manual_required";

export interface FillFieldResult {
  id: string;
  label: string;
  fieldType: string;
  status: FillFieldStatus;
  reason?: string;
  source?: "mapping" | "ai" | "fallback";
  confidence?: "high" | "medium" | "low";
}

export interface FillResult {
  filled: string[];
  skipped: string[];
  openEnded: DetectedField[];
  fieldResults: FillFieldResult[];
  resumeAttached: boolean;
}

export interface ApplyAiAnswerInput {
  id: string;
  answer: string;
  question?: string;
  selector?: string;
  questionHash?: string;
  groupKey?: string;
}

export interface ApplyAiAnswerResult {
  attempted: number;
  applied: number;
  failedIds: string[];
}

type SnapshotKind = "input" | "textarea" | "select" | "file";
type FillSnapshot = {
  selector: string;
  kind: SnapshotKind;
  previousValue: string;
  previousIndex?: number;
};

let lastSnapshots: FillSnapshot[] = [];

function selectorForElement(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const name = el.getAttribute("name");
  if (name) return `[name="${CSS.escape(name)}"]`;
  const path: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body) {
    const siblings = Array.from(current.parentElement?.children ?? []);
    const idx = siblings.indexOf(current) + 1;
    path.unshift(`${current.tagName.toLowerCase()}:nth-child(${idx})`);
    current = current.parentElement;
  }
  return path.join(" > ");
}

function getValueForField(fieldType: string, profile: ApplyProfile): string | null {
  const mapped = mapDeterministicValue(fieldType as never, profile);
  return mapped.value;
}

function normalizeText(v: string): string {
  return v.toLowerCase().replace(/\s+/g, " ").trim();
}

function getAllAccessibleDocuments(root: Document = document): Document[] {
  const out: Document[] = [root];
  const frames = Array.from(root.querySelectorAll("iframe"));
  for (const frame of frames) {
    try {
      const child = frame.contentDocument;
      if (!child) continue;
      out.push(...getAllAccessibleDocuments(child));
    } catch {
      // Cross-origin iframe.
    }
  }
  return out;
}

function queryElement<T extends Element>(selector: string): T | null {
  for (const doc of getAllAccessibleDocuments()) {
    const found = doc.querySelector(selector) as T | null;
    if (found) return found;
  }
  return null;
}

function snapshotIfNeeded(
  selector: string,
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  seen: Set<string>,
): void {
  if (seen.has(selector)) return;
  if (el instanceof HTMLSelectElement) {
    lastSnapshots.push({
      selector,
      kind: "select",
      previousValue: el.value,
      previousIndex: el.selectedIndex,
    });
  } else if (el instanceof HTMLInputElement && el.type === "file") {
    lastSnapshots.push({ selector, kind: "file", previousValue: "" });
  } else if (el instanceof HTMLTextAreaElement) {
    lastSnapshots.push({ selector, kind: "textarea", previousValue: el.value ?? "" });
  } else {
    lastSnapshots.push({ selector, kind: "input", previousValue: (el as HTMLInputElement).value ?? "" });
  }
  seen.add(selector);
}

async function fillElement(selector: string, value: string, seen: Set<string>): Promise<boolean> {
  const el = queryElement(selector) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
    | null;
  if (!el) return false;
  snapshotIfNeeded(selector, el, seen);

  el.focus();
  await sleep(30 + Math.random() * 70);

  if (el instanceof HTMLSelectElement) {
    const options = Array.from(el.options);
    const best = options.find(
      (o) =>
        o.text.toLowerCase().includes(value.toLowerCase()) ||
        o.value.toLowerCase().includes(value.toLowerCase()),
    );
    if (!best) return false;
    el.value = best.value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!nativeSetter) return false;
    nativeSetter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    const htmlInput = el as HTMLInputElement;
    const looksLikeAutocomplete =
      htmlInput.type === "search" ||
      htmlInput.getAttribute("role") === "combobox" ||
      htmlInput.getAttribute("aria-autocomplete") != null ||
      (htmlInput.placeholder ?? "").toLowerCase().includes("start typing");
    if (looksLikeAutocomplete) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowDown", bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    }
  }

  await sleep(30 + Math.random() * 50);
  const verifyValue = (target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string => {
    if (target instanceof HTMLSelectElement) {
      const opt = target.options[target.selectedIndex];
      return (opt?.text ?? target.value ?? "").trim().toLowerCase();
    }
    return String((target as HTMLInputElement | HTMLTextAreaElement).value ?? "")
      .trim()
      .toLowerCase();
  };
  const expected = value.trim().toLowerCase();
  if (expected && !verifyValue(el).includes(expected)) {
    if (el instanceof HTMLSelectElement) {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        el instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype,
        "value",
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    await sleep(40);
    if (expected && !verifyValue(el).includes(expected)) return false;
  }
  el.blur();
  return true;
}

function getCurrentTextValue(selector: string): string {
  const el = queryElement(selector) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
    | null;
  if (!el) return "";
  if (el instanceof HTMLSelectElement) {
    return (el.options[el.selectedIndex]?.text ?? el.value ?? "").trim();
  }
  return String(el.value ?? "").trim();
}

function choiceText(input: HTMLInputElement): string {
  const doc = input.ownerDocument ?? document;
  const bits: string[] = [];
  if (input.value) bits.push(input.value);
  if (input.id) {
    const byFor = doc.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (byFor?.textContent) bits.push(byFor.textContent);
  }
  const near = input.closest("label");
  if (near?.textContent) bits.push(near.textContent);
  const parentFieldset = input.closest("fieldset");
  const legend = parentFieldset?.querySelector("legend");
  if (legend?.textContent) bits.push(legend.textContent);
  return bits
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function clickChoiceInput(input: HTMLInputElement, seen: Set<string>): Promise<boolean> {
  snapshotIfNeeded(selectorForElement(input), input, seen);
  if (input.checked) return true;
  input.focus();
  input.click();
  input.checked = true;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function attachResume(
  selector: string,
  resumeFile: ResumeFilePayload,
  seen: Set<string>,
): Promise<boolean> {
  const el = queryElement(selector) as HTMLInputElement | null;
  if (!el || el.type !== "file") return false;
  snapshotIfNeeded(selector, el, seen);

  const file = new File([resumeFile.bytes], resumeFile.fileName, { type: resumeFile.contentType });
  const dt = new DataTransfer();
  dt.items.add(file);
  try {
    el.files = dt.files;
  } catch {
    return false;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

export async function fillStandardFields(
  fields: DetectedField[],
  profile: ApplyProfile,
  options?: { resumeFile?: ResumeFilePayload | null },
): Promise<FillResult> {
  lastSnapshots = [];
  const seen = new Set<string>();
  const filled: string[] = [];
  const skipped: string[] = [];
  const openEnded: DetectedField[] = [];
  const fieldResults: FillFieldResult[] = [];
  let resumeAttached = false;
  const processedChoiceGroups = new Set<string>();
  let pronounsHandled = false;
  let hearAboutHandled = false;

  for (const field of fields) {
    if (field.isOpenEnded) {
      openEnded.push(field);
      continue;
    }

    if (field.fieldType === "coverLetter") {
      fieldResults.push({
        id: field.id,
        label: field.label || "Cover letter",
        fieldType: field.fieldType,
        status: "manual_required",
        reason: "Cover letter is intentionally excluded",
      });
      skipped.push(field.label);
      continue;
    }

    if (field.fieldType === "resume") {
      if (!options?.resumeFile) {
        fieldResults.push({
          id: field.id,
          label: field.label || "Resume upload",
          fieldType: field.fieldType,
          status: "manual_required",
          reason: "No resume file available",
        });
        skipped.push(field.label);
        continue;
      }
      const attached = await attachResume(field.elementSelector, options.resumeFile, seen);
      if (attached) {
        resumeAttached = true;
        filled.push(field.label);
        fieldResults.push({
          id: field.id,
          label: field.label || "Resume upload",
          fieldType: field.fieldType,
          status: "filled",
        });
      } else {
        skipped.push(field.label);
        fieldResults.push({
          id: field.id,
          label: field.label || "Resume upload",
          fieldType: field.fieldType,
          status: "manual_required",
          reason: "ATS upload control blocked automatic attach",
        });
      }
      continue;
    }

    if (field.fieldType === "pronouns") {
      if (pronounsHandled) continue;
      pronounsHandled = true;
      const gk = field.groupKey ?? field.id;
      if (processedChoiceGroups.has(gk)) continue;
      processedChoiceGroups.add(gk);
      const preferredPronoun =
        ((profile as unknown as Record<string, unknown>).pronouns as string | undefined) ??
        "prefer not to say";
      const members = fields.filter((f) => f.groupKey === gk && f.fieldType === "pronouns");
      let selected = false;
      for (const member of members) {
        const input = queryElement<HTMLInputElement>(member.elementSelector);
        if (!input || input.type !== "radio") continue;
        const label = normalizeText(choiceText(input) || member.label || "");
        if (
          label.includes(normalizeText(preferredPronoun)) ||
          (preferredPronoun.toLowerCase().includes("prefer") && label.includes("prefer not"))
        ) {
          selected = await clickChoiceInput(input, seen);
          break;
        }
      }
      const success = selected;
      if (success) {
        filled.push(field.label);
        fieldResults.push({
          id: field.id,
          label: field.label,
          fieldType: field.fieldType,
          status: "filled",
        });
      } else {
        skipped.push(field.label || "pronouns");
        fieldResults.push({
          id: field.id,
          label: field.label,
          fieldType: field.fieldType,
          status: "failed",
          reason: "Could not select pronouns option",
        });
      }
      continue;
    }

    if (field.fieldType === "hearAbout") {
      if (hearAboutHandled) continue;
      hearAboutHandled = true;
      const members = fields.filter((f) => f.fieldType === "hearAbout");
      const groupLabel =
        members.find((m) => m.groupLabel)?.groupLabel ??
        members.find((m) => m.questionText)?.questionText ??
        "How did you hear about this role?";
      const shortReason = "Select manually (source options not auto-filled)";
      for (const member of members) {
        skipped.push(member.label || groupLabel);
        fieldResults.push({
          id: member.id,
          label: member.label?.trim() || normalizeText(groupLabel).slice(0, 120) || "Source",
          fieldType: "hearAbout",
          status: "manual_required",
          reason: shortReason,
        });
      }
      continue;
    }

    const mapped =
      field.fieldType === "unknown" && /start typing/.test(field.label.toLowerCase())
        ? { value: [profile.city?.trim(), profile.country?.trim()].filter(Boolean).join(", "), source: "fallback" as const, confidence: "medium" as const }
        : mapDeterministicValue(field.fieldType as never, profile);
    const factual = resolveFactualField(
      {
        fieldType: field.fieldType,
        label: field.label,
        inputType: field.inputType,
        options: field.options,
        questionText: field.questionText,
        groupLabel: field.groupLabel,
        sectionLabel: field.sectionLabel,
        hintText: field.hintText,
      },
      profile,
    );
    const chosen = mapped.value ? mapped : (factual ?? mapped);
    const value =
      field.fieldType === "unknown" && /start typing/.test(field.label.toLowerCase())
        ? mapped.value
        : chosen.value ?? getValueForField(field.fieldType, profile);
    if (!value) {
      skipped.push(field.label);
      fieldResults.push({
        id: field.id,
        label: field.label,
        fieldType: field.fieldType,
        status: "skipped",
        reason: "No profile value",
        source: "fallback",
        confidence: "low",
      });
      continue;
    }
    if (chosen.confidence === "low") {
      skipped.push(field.label);
      fieldResults.push({
        id: field.id,
        label: field.label,
        fieldType: field.fieldType,
        status: "skipped",
        reason: "Low-confidence fill skipped",
        source: chosen.source,
        confidence: chosen.confidence,
      });
      continue;
    }

    const existing = getCurrentTextValue(field.elementSelector);
    if (existing && existing.toLowerCase() !== value.toLowerCase()) {
      skipped.push(field.label);
      fieldResults.push({
        id: field.id,
        label: field.label,
        fieldType: field.fieldType,
        status: "skipped",
        reason: "Existing user value present",
        source: "fallback",
        confidence: "medium",
      });
      continue;
    }

    const success = await fillElement(field.elementSelector, value, seen);
    if (success) {
      filled.push(field.label);
      fieldResults.push({
        id: field.id,
        label: field.label,
        fieldType: field.fieldType,
        status: "filled",
        source: chosen.source,
        confidence: chosen.confidence,
      });
    } else {
      skipped.push(field.label);
      fieldResults.push({
        id: field.id,
        label: field.label,
        fieldType: field.fieldType,
        status: "failed",
        reason: "Field not interactable",
        source: chosen.source,
        confidence: "low",
      });
    }

    await sleep(50 + Math.random() * 100);
  }

  return { filled, skipped, openEnded, fieldResults, resumeAttached };
}

export async function fillAIAnswers(answers: Array<{ id: string; answer: string }>): Promise<void> {
  await fillAIAnswersWithFallback(answers, []);
}

function normalizeForMatch(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(v: string): Set<string> {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "your",
    "you",
    "have",
    "this",
    "that",
    "what",
    "when",
    "where",
    "about",
    "from",
    "into",
    "tell",
    "describe",
    "please",
    "type",
    "here",
  ]);
  return new Set(
    normalizeForMatch(v)
      .split(" ")
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !stop.has(t)),
  );
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.max(1, a.size);
}

function findFallbackSelector(
  input: ApplyAiAnswerInput,
  detectedFields: DetectedField[],
): string | null {
  if (input.groupKey) {
    const byGroup = detectedFields.find((f) => f.isOpenEnded && f.groupKey && f.groupKey === input.groupKey);
    if (byGroup?.elementSelector) return byGroup.elementSelector;
  }
  if (input.questionHash) {
    const byHash = detectedFields.find((f) => f.isOpenEnded && f.questionHash && f.questionHash === input.questionHash);
    if (byHash?.elementSelector) return byHash.elementSelector;
  }
  if (!input.question) return null;
  const q = normalizeForMatch(input.question);
  if (!q) return null;
  const qTokens = tokenSet(input.question);
  const intent = extractIntent(input.question);
  const intentTokens = new Set(intent.keywords);
  let best: { selector: string; score: number } | null = null;
  for (const f of detectedFields) {
    if (!f.isOpenEnded) continue;
    const l = normalizeForMatch([f.label, f.questionText, f.groupLabel].filter(Boolean).join(" "));
    if (!l) continue;
    if (l.includes(q) || q.includes(l)) return f.elementSelector;
    const score = Math.max(overlapScore(qTokens, tokenSet(f.label)), overlapScore(intentTokens, tokenSet(f.label)));
    if (score >= 0.35 && (!best || score > best.score)) {
      best = { selector: f.elementSelector, score };
    }
  }
  return best?.selector ?? null;
}

function uniqueSelectors(selectors: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of selectors) {
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function unresolvedTextAnswerSelectors(usedSelectors: Set<string>, detectedFields: DetectedField[]): string[] {
  const list = detectedFields
    .filter((f) => f.isOpenEnded)
    .map((f) => f.elementSelector)
    .filter(Boolean);
  return list.filter((s) => !usedSelectors.has(s));
}

export async function fillAIAnswersWithFallback(
  answers: ApplyAiAnswerInput[],
  detectedFields: DetectedField[],
): Promise<ApplyAiAnswerResult> {
  const seen = new Set<string>();
  const usedSelectors = new Set<string>();
  let applied = 0;
  const failedIds: string[] = [];
  const unresolved: ApplyAiAnswerInput[] = [];

  for (const input of answers) {
    const selById = `[data-jsa-id="${CSS.escape(input.id)}"]`;
    const byIdEl = queryElement<HTMLElement>(selById);
    const selectorCandidates = uniqueSelectors([
      input.selector,
      byIdEl ? selById : null,
      findFallbackSelector(input, detectedFields),
    ]);
    let success = false;
    for (const selector of selectorCandidates) {
      const existing = getCurrentTextValue(selector);
      if (existing && existing.toLowerCase() !== input.answer.trim().toLowerCase()) continue;
      const ok = await fillElement(selector, input.answer, seen);
      if (ok) {
        usedSelectors.add(selector);
        applied++;
        success = true;
        break;
      }
    }
    if (!success) unresolved.push(input);
    await sleep(80 + Math.random() * 90);
  }

  if (unresolved.length > 0) {
    const fallbackSelectors = unresolvedTextAnswerSelectors(usedSelectors, detectedFields);
    let idx = 0;
    for (const input of unresolved) {
      const selector = fallbackSelectors[idx++];
      if (!selector) {
        failedIds.push(input.id);
        continue;
      }
      const ok = await fillElement(selector, input.answer, seen);
      if (ok) {
        usedSelectors.add(selector);
        applied++;
      } else {
        failedIds.push(input.id);
      }
      await sleep(80 + Math.random() * 90);
    }
  }
  return {
    attempted: answers.length,
    applied,
    failedIds,
  };
}

export async function undoLastFill(): Promise<{ restored: number }> {
  let restored = 0;
  for (let i = lastSnapshots.length - 1; i >= 0; i--) {
    const snap = lastSnapshots[i];
    if (!snap) continue;
    const el = queryElement(snap.selector) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | null;
    if (!el) continue;

    if (snap.kind === "select" && el instanceof HTMLSelectElement) {
      el.value = snap.previousValue;
      if (typeof snap.previousIndex === "number") el.selectedIndex = snap.previousIndex;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      restored++;
      continue;
    }

    if (snap.kind === "file" && el instanceof HTMLInputElement && el.type === "file") {
      el.value = "";
      el.dispatchEvent(new Event("change", { bubbles: true }));
      restored++;
      continue;
    }

    const proto =
      el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (!nativeSetter) continue;
    nativeSetter.call(el, snap.previousValue);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    restored++;
  }
  lastSnapshots = [];
  return { restored };
}
