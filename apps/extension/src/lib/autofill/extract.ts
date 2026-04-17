import type { FieldContext, FieldMetadata } from "./types";

function normalizeText(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

function normalizeForHash(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashQuestion(v: string): string {
  const s = normalizeForHash(v);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `q_${(h >>> 0).toString(16)}`;
}

function selectorForElement(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const name = el.getAttribute("name");
  if (name) return `[name="${CSS.escape(name)}"]`;
  const path: string[] = [];
  let current: Element | null = el;
  const rootBody = el.ownerDocument?.body ?? document.body;
  while (current && current !== rootBody) {
    const siblings = Array.from(current.parentElement?.children ?? []);
    const idx = siblings.indexOf(current) + 1;
    path.unshift(`${current.tagName.toLowerCase()}:nth-child(${idx})`);
    current = current.parentElement;
  }
  return path.join(" > ");
}

function readByIds(el: Element, attr: string): string[] {
  const doc = el.ownerDocument ?? document;
  const raw = el.getAttribute(attr);
  if (!raw) return [];
  const out: string[] = [];
  for (const idRef of raw.split(/\s+/).map((s) => s.trim()).filter(Boolean)) {
    const node = doc.getElementById(idRef);
    const txt = normalizeText(node?.textContent ?? "");
    if (txt) out.push(txt);
  }
  return out;
}

function containerTextLength(el: Element | null): number {
  if (!el) return Number.MAX_SAFE_INTEGER;
  return normalizeText(el.textContent ?? "").length;
}

function findFieldContainer(el: Element): Element {
  let current: Element = el;
  let best: Element = el.parentElement ?? el;
  for (let i = 0; i < 6 && current.parentElement; i++) {
    current = current.parentElement;
    const textLen = containerTextLength(current);
    const formNodes = current.querySelectorAll("input, textarea, select").length;
    if (textLen >= 10 && textLen <= 500 && formNodes <= 8) {
      best = current;
      break;
    }
    if (textLen <= 700 && formNodes <= 10) {
      best = current;
    }
  }
  return best;
}

function getNearbyText(el: Element): string {
  const bits: string[] = [];
  const fieldset = el.closest("fieldset");
  if (fieldset) {
    const legend = normalizeText(fieldset.querySelector("legend")?.textContent ?? "");
    if (legend) bits.push(legend);
  }
  let parent: Element | null = el.parentElement;
  for (let i = 0; i < 2 && parent; i++) {
    const prev = normalizeText(parent.previousElementSibling?.textContent ?? "");
    if (prev) bits.push(prev);
    parent = parent.parentElement;
  }
  return bits.join(" ").slice(0, 260);
}

function getLabel(el: Element): string {
  const doc = el.ownerDocument ?? document;
  const bits: string[] = [];
  const push = (v: string | null | undefined) => {
    const t = normalizeText(v ?? "");
    if (t) bits.push(t);
  };
  push(el.getAttribute("aria-label"));
  push(el.getAttribute("placeholder"));
  push(el.getAttribute("name"));
  const id = el.getAttribute("id");
  if (id) {
    push(doc.querySelector(`label[for="${id}"]`)?.textContent ?? null);
  }
  push(el.closest("label")?.textContent ?? null);
  for (const txt of readByIds(el, "aria-labelledby")) push(txt);
  for (const txt of readByIds(el, "aria-describedby")) push(txt);
  return Array.from(new Set(bits)).join(" ").toLowerCase().replace(/[_-]+/g, " ").slice(0, 220);
}

function optionList(el: Element): Array<{ value: string; label: string }> {
  if (el instanceof HTMLSelectElement) {
    return Array.from(el.options).map((o) => ({ value: o.value, label: normalizeText(o.textContent ?? "") }));
  }
  return [];
}

function optionLabels(el: Element): string[] {
  const doc = el.ownerDocument ?? document;
  if (el instanceof HTMLSelectElement) {
    return Array.from(el.options)
      .map((o) => normalizeText(o.textContent ?? ""))
      .filter(Boolean)
      .slice(0, 20);
  }
  if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
    const byName =
      el.name && el.form
        ? Array.from(
            el.form.querySelectorAll<HTMLInputElement>(`input[type="${el.type}"][name="${CSS.escape(el.name)}"]`),
          )
        : [];
    const pool = byName.length ? byName : [el];
    const labels = pool
      .map((n) => {
        const byFor = n.id ? doc.querySelector(`label[for="${CSS.escape(n.id)}"]`)?.textContent : "";
        const near = n.closest("label")?.textContent ?? "";
        return normalizeText([n.value, byFor, near].join(" "));
      })
      .filter(Boolean);
    return Array.from(new Set(labels)).slice(0, 20);
  }
  return [];
}

function getSectionLabel(el: Element): string {
  let parent: Element | null = el.parentElement;
  for (let i = 0; i < 6 && parent; i++) {
    const heading = parent.querySelector("h1, h2, h3, h4, legend");
    const txt = normalizeText(heading?.textContent ?? "");
    if (txt && txt.length <= 120) return txt;
    parent = parent.parentElement;
  }
  return "";
}

function getGroupLabel(el: Element): string {
  const doc = el.ownerDocument ?? document;
  const fieldset = el.closest("fieldset");
  const legend = normalizeText(fieldset?.querySelector("legend")?.textContent ?? "");
  if (legend) return legend;
  if (el instanceof HTMLInputElement && el.name) {
    const named = doc.querySelector<HTMLInputElement>(`input[name="${CSS.escape(el.name)}"]`);
    const labelByFor =
      named?.id ? normalizeText(doc.querySelector(`label[for="${CSS.escape(named.id)}"]`)?.textContent ?? "") : "";
    if (labelByFor) return labelByFor;
    const near = normalizeText(named?.closest("label")?.textContent ?? "");
    if (near) return near;
  }
  return "";
}

function getHintText(el: Element): string {
  const described = readByIds(el, "aria-describedby").join(" ");
  if (described) return normalizeText(described).slice(0, 180);
  const ph = normalizeText(el.getAttribute("placeholder") ?? "");
  return ph.slice(0, 180);
}

export function getFieldContext(el: Element): FieldContext {
  const label = getLabel(el);
  const container = findFieldContainer(el);
  const containerText = normalizeText(container.textContent ?? "");
  const questionText = containerText.slice(0, 380);
  const groupLabel = getGroupLabel(el);
  const sectionLabel = getSectionLabel(container);
  const options = optionLabels(el);
  const hintText = getHintText(el);
  return {
    label,
    questionText,
    groupLabel,
    sectionLabel,
    options,
    hintText,
  };
}

function isAtsHelperContainerText(v: string): boolean {
  const hay = normalizeText(v).toLowerCase();
  return (
    hay.includes("autofill from resume") ||
    hay.includes("upload your resume here to autofill key application fields") ||
    hay.includes("we'll autofill key application fields")
  );
}

function looksLikeRealFieldLabel(v: string): boolean {
  const hay = normalizeText(v).toLowerCase();
  return /(name|email|phone|resume|linkedin|github|portfolio|country|location|salary|experience|question|address|city|state|zip|pronouns|hear|source)/.test(
    hay,
  );
}

function isSiteChromeInput(el: Element): boolean {
  if (el.closest("header, nav, [role='banner'], [role='navigation'], [role='search'], footer")) {
    return true;
  }
  if (el instanceof HTMLInputElement) {
    if (el.type === "search") return true;
    const id = (el.getAttribute("id") ?? "").toLowerCase();
    const name = (el.getAttribute("name") ?? "").toLowerCase();
    const aria = (el.getAttribute("aria-label") ?? "").toLowerCase();
    if (/^(s|q|query|search|site-search|global-search)$/.test(name)) return true;
    if (/\b(site[-\s]?search|search\s+site|global\s+search)\b/.test(id)) return true;
    if (el.getAttribute("role") === "combobox" && /\bsearch\b/.test(aria)) return true;
  }
  return false;
}

/** Locale / language menu (English, Deutsch, 日本語) — not an application field. */
function isLanguageSwitcherSelect(el: Element): boolean {
  if (!(el instanceof HTMLSelectElement)) return false;
  const opts = Array.from(el.options)
    .map((o) => normalizeText(o.textContent ?? "").toLowerCase())
    .filter(Boolean);
  if (opts.length < 4) return false;
  const langMarkers = [
    "english",
    "deutsch",
    "français",
    "francais",
    "italiano",
    "日本語",
    "español",
    "espanol",
    "português",
    "portugues",
    "nederlands",
    "language",
    "繁體中文",
    "한국어",
  ];
  const hits = opts.filter((o) => langMarkers.some((m) => o.includes(m))).length;
  return hits >= 3;
}

function shouldSkip(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, label: string, context: FieldContext): boolean {
  if (el.disabled) return true;
  if (el instanceof HTMLInputElement && (el.readOnly || ["hidden", "submit", "button", "password"].includes(el.type))) {
    return true;
  }
  if (el instanceof HTMLTextAreaElement && el.readOnly) return true;
  if (/captcha|recaptcha|h-captcha/i.test(label)) return true;
  if (isSiteChromeInput(el)) return true;
  if (isLanguageSwitcherSelect(el)) return true;
  const helperHay = [context.questionText, context.groupLabel, context.sectionLabel].join(" ");
  const localHay = [label, el.getAttribute("placeholder"), el.getAttribute("name")].join(" ");
  if (isAtsHelperContainerText(helperHay) && !looksLikeRealFieldLabel(localHay)) {
    return true;
  }
  return false;
}

function normalizeChoiceGroupKey(type: "radio" | "checkbox", input: HTMLInputElement, label: string): string {
  const fieldset = input.closest("fieldset");
  const legend = normalizeText(fieldset?.querySelector("legend")?.textContent ?? "");
  if (legend) return `${type}:${legend.toLowerCase()}`;
  if (input.name?.trim()) return `${type}:name:${input.name.trim().toLowerCase()}`;
  const parentSig = normalizeText(input.parentElement?.className || input.parentElement?.tagName || "");
  if (parentSig) return `${type}:parent:${parentSig.toLowerCase()}`;
  if (label) return `${type}:label:${label.toLowerCase()}`;
  return `${type}:id:${(input.id || "unknown").toLowerCase()}`;
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

export function extractFieldMetadata(): FieldMetadata[] {
  const nodes = getAllAccessibleDocuments().flatMap((doc) =>
    Array.from(doc.querySelectorAll("input, textarea, select")),
  );
  const out: FieldMetadata[] = [];
  let idx = 0;
  for (const node of nodes) {
    const input = node as HTMLInputElement;
    const context = getFieldContext(node);
    const label = context.label;
    if (shouldSkip(input, label, context)) continue;

    let id = node.getAttribute("data-jsa-id");
    if (!id) {
      id = `jsa-field-${idx++}`;
      node.setAttribute("data-jsa-id", id);
    }

    const groupKey =
      input.type === "radio" || input.type === "checkbox"
        ? normalizeChoiceGroupKey(input.type as "radio" | "checkbox", input, label)
        : undefined;

    out.push({
      id,
      label,
      placeholder: normalizeText(node.getAttribute("placeholder") ?? ""),
      name: normalizeText(node.getAttribute("name") ?? ""),
      inputType: input.type || node.tagName.toLowerCase(),
      required: Boolean(input.required),
      options: optionList(node),
      nearbyText: getNearbyText(node),
      context,
      selector: `[data-jsa-id="${id}"]`,
      groupKey,
      charLimit: input.maxLength > 0 ? input.maxLength : undefined,
      questionHash: hashQuestion([context.questionText, context.groupLabel, context.label].join(" ")),
    });
  }

  const grouped = new Map<string, FieldMetadata[]>();
  for (const row of out) {
    if (!row.groupKey) continue;
    const list = grouped.get(row.groupKey) ?? [];
    list.push(row);
    grouped.set(row.groupKey, list);
  }
  for (const [, rows] of grouped) {
    if (rows.length < 2) continue;
    const groupLabel = rows.map((r) => r.context.groupLabel).find((v) => v && v.length > 0) ?? "";
    const questionText = rows
      .map((r) => r.context.questionText)
      .sort((a, b) => (b?.length ?? 0) - (a?.length ?? 0))[0] ?? "";
    const sectionLabel = rows.map((r) => r.context.sectionLabel).find((v) => v && v.length > 0) ?? "";
    const options = Array.from(new Set(rows.flatMap((r) => r.context.options))).filter(Boolean).slice(0, 20);
    for (const row of rows) {
      row.context.groupLabel = groupLabel || row.context.groupLabel;
      row.context.questionText = questionText || row.context.questionText;
      row.context.sectionLabel = sectionLabel || row.context.sectionLabel;
      row.context.options = options.length ? options : row.context.options;
      row.questionHash = hashQuestion(
        [row.context.questionText, row.context.groupLabel, row.context.label].join(" "),
      );
    }
  }
  return out;
}

