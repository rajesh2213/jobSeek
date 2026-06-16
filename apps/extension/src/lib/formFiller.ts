import type { DetectedField } from "./fieldDetector";
import { shouldAutoFillWithAi } from "./aiNarrativeFields";
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
  noticePeriod?: string;
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
  /** When true (e.g. sidebar “Generate with AI”), apply even if the field already has a different value. */
  forceReplace?: boolean;
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

/** Lexical / ProseMirror / Ashby stacks often hide the real `<textarea>` and show `[contenteditable]`. */
function findRichTextSurface(control: HTMLElement): HTMLElement | null {
  let p: HTMLElement | null = control.parentElement;
  for (let depth = 0; depth < 9 && p; depth++) {
    const candidates = Array.from(p.querySelectorAll<HTMLElement>('[contenteditable="true"]'));
    for (const ce of candidates) {
      const r = ce.getBoundingClientRect();
      if (r.width < 14 || r.height < 14) continue;
      const rc = control.getBoundingClientRect();
      const verticallyNear = !(r.bottom < rc.top - 120 || r.top > rc.bottom + 120);
      if (verticallyNear) return ce;
    }
    p = p.parentElement;
  }
  return null;
}

function findRichTextCompanion(surface: HTMLElement): HTMLTextAreaElement | HTMLInputElement | null {
  let root: HTMLElement | null = surface.parentElement;
  for (let depth = 0; depth < 10 && root; depth++) {
    for (const ta of Array.from(root.querySelectorAll("textarea"))) {
      if (!(ta instanceof HTMLTextAreaElement)) continue;
      const r = ta.getBoundingClientRect();
      if (r.width <= 6 || r.height <= 6 || ta.getAttribute("aria-hidden") === "true") return ta;
    }
    for (const inp of Array.from(root.querySelectorAll('input[type="text"], input:not([type])'))) {
      if (!(inp instanceof HTMLInputElement) || inp === surface) continue;
      const r = inp.getBoundingClientRect();
      if (r.width <= 6 || r.height <= 6) return inp;
    }
    root = root.parentElement;
  }
  return null;
}

function readSurfaceText(surface: HTMLElement): string {
  return (surface.innerText ?? surface.textContent ?? "").trim();
}

function verificationProbe(expectedRaw: string): string {
  const e = expectedRaw.trim().toLowerCase();
  return e.slice(0, Math.min(260, e.length));
}

function verifyFilledText(expectedRaw: string, ...surfaces: Array<string | HTMLElement | null | undefined>): boolean {
  const probe = verificationProbe(expectedRaw);
  if (!probe) return false;
  for (const surface of surfaces) {
    const got = typeof surface === "string" ? surface : surface ? readSurfaceText(surface) : "";
    if (got.trim().toLowerCase().includes(probe)) return true;
  }
  return false;
}

function readFilledText(
  control: HTMLInputElement | HTMLTextAreaElement,
  rich: HTMLElement | null,
): string {
  const native = String(control.value ?? "").trim().toLowerCase();
  if (rich) {
    const ce = (rich.innerText ?? rich.textContent ?? "").trim().toLowerCase();
    return ce.length >= native.length ? ce : native;
  }
  return native;
}

async function fillRichTextSurface(surface: HTMLElement, text: string): Promise<void> {
  const doc = surface.ownerDocument ?? document;
  const companion = findRichTextCompanion(surface);
  surface.focus({ preventScroll: true });
  await sleep(30);
  try {
    const sel = doc.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(surface);
    sel?.removeAllRanges();
    sel?.addRange(range);
    doc.execCommand("selectAll", false);
    doc.execCommand("delete", false);
    doc.execCommand("insertText", false, text);
  } catch {
    surface.textContent = text;
  }
  if (companion) {
    const proto =
      companion instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) nativeSetter.call(companion, text);
  }
  surface.dispatchEvent(
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: text.slice(0, Math.min(256, text.length)),
    }),
  );
  surface.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: text.slice(0, Math.min(256, text.length)),
    }),
  );
  surface.dispatchEvent(new Event("change", { bubbles: true }));
  companion?.dispatchEvent(new Event("input", { bubbles: true }));
  companion?.dispatchEvent(new Event("change", { bubbles: true }));
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
  const valueTrim = value.trim();
  if (!valueTrim) return false;

  const raw = queryElement(selector);
  if (
    raw instanceof HTMLElement &&
    raw.getAttribute("contenteditable") === "true" &&
    !(raw instanceof HTMLInputElement) &&
    !(raw instanceof HTMLTextAreaElement) &&
    !(raw instanceof HTMLSelectElement)
  ) {
    const companion = findRichTextCompanion(raw);
    await fillRichTextSurface(raw, valueTrim);
    await sleep(80 + Math.random() * 100);
    const ok = verifyFilledText(valueTrim, raw, companion?.value ?? companion);
    if (!ok) seen.delete(selector);
    else seen.add(selector);
    return ok;
  }

  const el = raw as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  if (!el) return false;
  snapshotIfNeeded(selector, el, seen);

  el.focus();
  await sleep(30 + Math.random() * 70);

  if (el instanceof HTMLSelectElement) {
    const options = Array.from(el.options);
    const best = options.find(
      (o) =>
        o.text.toLowerCase().includes(valueTrim.toLowerCase()) ||
        o.value.toLowerCase().includes(valueTrim.toLowerCase()),
    );
    if (!best) return false;
    el.value = best.value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    const proto =
      el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (!nativeSetter) return false;

    const rich = findRichTextSurface(el);
    if (rich) {
      await fillRichTextSurface(rich, valueTrim);
      nativeSetter.call(el, valueTrim);
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: valueTrim.slice(0, Math.min(256, valueTrim.length)),
        }),
      );
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      nativeSetter.call(el, valueTrim);
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
  }

  await sleep(45 + Math.random() * 55);

  const verifySelectOrNative = (): boolean => {
    if (el instanceof HTMLSelectElement) {
      const opt = el.options[el.selectedIndex];
      const got = (opt?.text ?? el.value ?? "").trim().toLowerCase();
      const probe = verificationProbe(valueTrim);
      return probe.length > 0 && got.includes(probe);
    }
    const richNow = findRichTextSurface(el);
    const got = readFilledText(el, richNow);
    const probe = verificationProbe(valueTrim);
    return probe.length > 0 && got.includes(probe);
  };

  if (!verifySelectOrNative()) {
    if (el instanceof HTMLSelectElement) {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      const proto =
        el instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      const richRetry = findRichTextSurface(el);
      if (richRetry && nativeSetter) {
        await fillRichTextSurface(richRetry, valueTrim);
        nativeSetter.call(el, valueTrim);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (nativeSetter) {
        nativeSetter.call(el, valueTrim);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    await sleep(70);
    if (!verifySelectOrNative()) {
      seen.delete(selector);
      return false;
    }
  }

  el.blur();
  findRichTextSurface(el)?.blur();
  await sleep(90);
  const ok = verifySelectOrNative();
  if (!ok) seen.delete(selector);
  return ok;
}

function getCurrentTextValue(selector: string): string {
  const raw = queryElement(selector);
  if (
    raw instanceof HTMLElement &&
    raw.getAttribute("contenteditable") === "true" &&
    !(raw instanceof HTMLInputElement) &&
    !(raw instanceof HTMLTextAreaElement) &&
    !(raw instanceof HTMLSelectElement)
  ) {
    return (raw.innerText ?? raw.textContent ?? "").trim();
  }
  const el = raw as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  if (!el) return "";
  if (el instanceof HTMLSelectElement) {
    return (el.options[el.selectedIndex]?.text ?? el.value ?? "").trim();
  }
  const native = String(el.value ?? "").trim();
  const rich = findRichTextSurface(el);
  const ce = rich ? (rich.innerText ?? rich.textContent ?? "").trim() : "";
  return ce.length > native.length ? ce : native;
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
    if (field.isOpenEnded || shouldAutoFillWithAi(field)) {
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

function isAiTextField(field: DetectedField): boolean {
  return field.isOpenEnded || shouldAutoFillWithAi(field);
}

function resolveFieldForAnswer(
  input: ApplyAiAnswerInput,
  detectedFields: DetectedField[],
): DetectedField | null {
  if (input.questionHash) {
    const byHash = detectedFields.find((f) => f.questionHash === input.questionHash);
    if (byHash) return byHash;
  }
  if (input.question) {
    const q = normalizeForMatch(input.question);
    if (q) {
      let best: { field: DetectedField; score: number } | null = null;
      const qTokens = tokenSet(input.question);
      for (const f of detectedFields) {
        if (!isAiTextField(f)) continue;
        const hay = normalizeForMatch(
          [f.questionText, f.groupLabel, f.label, f.hintText].filter(Boolean).join(" "),
        );
        if (!hay) continue;
        if (hay.includes(q) || q.includes(hay)) return f;
        const score = overlapScore(qTokens, tokenSet(hay));
        if (score >= 0.35 && (!best || score > best.score)) {
          best = { field: f, score };
        }
      }
      if (best) return best.field;
    }
  }
  if (input.groupKey) {
    const byGroup = detectedFields.find((f) => f.groupKey === input.groupKey);
    if (byGroup) return byGroup;
  }
  return detectedFields.find((f) => f.id === input.id) ?? null;
}

function findFallbackSelector(
  input: ApplyAiAnswerInput,
  detectedFields: DetectedField[],
): string | null {
  const matched = resolveFieldForAnswer(input, detectedFields);
  if (matched?.elementSelector) return matched.elementSelector;
  if (!input.question) return null;
  const q = normalizeForMatch(input.question);
  if (!q) return null;
  const qTokens = tokenSet(input.question);
  const intent = extractIntent(input.question);
  const intentTokens = new Set(intent.keywords);
  let best: { selector: string; score: number } | null = null;
  for (const f of detectedFields) {
    if (!isAiTextField(f)) continue;
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

function selectorCandidatesForAnswer(
  input: ApplyAiAnswerInput,
  detectedFields: DetectedField[],
): string[] {
  const matched = resolveFieldForAnswer(input, detectedFields);
  const selById = `[data-jsa-id="${CSS.escape(matched?.id ?? input.id)}"]`;
  const byIdEl = matched ? queryElement<HTMLElement>(matched.elementSelector) : null;
  return uniqueSelectors([
    matched?.elementSelector,
    byIdEl ? selById : null,
    input.selector,
    findFallbackSelector(input, detectedFields),
  ]);
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
    const selectorCandidates = selectorCandidatesForAnswer(input, detectedFields);
    let success = false;
    for (const selector of selectorCandidates) {
      const el = queryElement(selector);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: "center", behavior: "instant" });
      }
      const existing = getCurrentTextValue(selector);
      if (
        !input.forceReplace &&
        existing &&
        existing.toLowerCase() !== input.answer.trim().toLowerCase()
      ) {
        continue;
      }
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
    for (const input of unresolved) {
      const matched = resolveFieldForAnswer(input, detectedFields);
      const selector = matched?.elementSelector ?? findFallbackSelector(input, detectedFields);
      if (!selector) {
        failedIds.push(input.id);
        continue;
      }
      const el = queryElement(selector);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: "center", behavior: "instant" });
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
