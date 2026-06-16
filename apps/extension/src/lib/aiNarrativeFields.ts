import type { FieldType } from "./autofill/types";
import type { DetectedField } from "./fieldDetector";

const PROFILE_FIELD_TYPES = new Set<FieldType>([
  "email",
  "phone",
  "linkedin",
  "github",
  "salary",
  "fullName",
  "firstName",
  "lastName",
  "location",
  "address",
  "city",
  "country",
  "zipCode",
  "portfolio",
  "website",
  "currentTitle",
  "currentCompany",
  "yearsExperience",
  "availability",
  "workAuthorization",
  "pronouns",
  "resume",
  "coverLetter",
  "hearAbout",
  "boolean",
  "select",
]);

/** Essay / narrative prompts — shared by classification and autofill routing. */
export function looksLikeNarrativePrompt(hay: string): boolean {
  if (!hay.trim()) return false;
  if (/\?/.test(hay)) {
    if (
      /(describe|tell us|explain|walk us through|why|how would|what (?:is your|was your|are your|would you)|elaborate|detail|what practices|what challenges|have you (?:made|worked|built|designed|implemented)|share with us|your role)/i.test(
        hay,
      )
    ) {
      return true;
    }
  }
  if (
    /\b(have you|did you)\b/i.test(hay) &&
    /\b(worked|built|designed|implemented|experience|production|architecture|environment)\b/i.test(hay)
  ) {
    return true;
  }
  return /(describe|tell us about your experience|tell us|explain|walk us through|contribution|open source|async|remote environment|remote work|challenges have you faced|practices or approaches|postgres|postgresql|founder|referrer|load balancing|query routing|production environment|architecture looked|your role in)/i.test(
    hay,
  );
}

export function narrativeHay(
  field: Pick<DetectedField, "label" | "questionText" | "groupLabel" | "hintText">,
): string {
  return [field.label, field.questionText, field.groupLabel, field.hintText].filter(Boolean).join(" ").trim();
}

/** Prefer the field's own prompt over bloated container copy (Ashby repeats the whole form). */
function focusedNarrativeHay(
  field: Pick<DetectedField, "label" | "questionText" | "groupLabel" | "hintText">,
): string {
  const qt = field.questionText?.trim() ?? "";
  if (qt.length > 0 && qt.length <= 520) {
    return [field.groupLabel, qt, field.hintText].filter(Boolean).join(" ").trim();
  }
  return narrativeHay(field);
}

/** Whether autofill should defer this field to the Smart Apply AI batch. */
export function shouldAutoFillWithAi(field: DetectedField): boolean {
  const ft = field.fieldType;
  if (ft === "hearAbout" || ft === "resume" || ft === "coverLetter") return false;

  const inputType = (field.inputType ?? "").toLowerCase();
  if (inputType === "radio" || inputType === "checkbox" || inputType === "file" || inputType === "select-one" || inputType === "select") {
    return false;
  }

  const hay = focusedNarrativeHay(field);
  if (looksLikeNarrativePrompt(hay)) return true;
  if (field.isOpenEnded || field.fieldType === "openEnded") return true;
  if (PROFILE_FIELD_TYPES.has(field.fieldType)) return false;

  const textLike =
    inputType === "textarea" ||
    inputType === "contenteditable" ||
    inputType === "text" ||
    inputType === "search";
  if (!textLike) return false;

  if (inputType === "textarea" || inputType === "contenteditable") {
    return looksLikeNarrativePrompt(hay);
  }

  if (field.fieldType === "long_text" || field.fieldType === "unknown") {
    return looksLikeNarrativePrompt(hay) || (field.charLimit ?? 0) >= 180 || hay.length >= 48;
  }

  return looksLikeNarrativePrompt(hay);
}

export function collectAiAutofillFields(fields: DetectedField[]): DetectedField[] {
  const out: DetectedField[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    if (!shouldAutoFillWithAi(field)) continue;
    if (seen.has(field.id)) continue;
    seen.add(field.id);
    out.push(field);
  }
  return out;
}
