import type { FieldType } from "../lib/autofill/types";
import type { DetectedField } from "../lib/fieldDetector";
import type { FieldState } from "./store";

/** Profile-backed factual types — idle rows should use Smart Apply mapping, not manual AI. */
const DETERMINISTIC_PROFILE_FIELD_TYPES = new Set<FieldType>([
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
]);

export function isTextLikeControl(inputType?: string): boolean {
  const t = (inputType ?? "").toLowerCase();
  return t === "textarea" || t === "text" || t === "search";
}

/**
 * Visibility for “Generate with AI” — open-ended / skipped / failed / manual-required / idle narrative only;
 * never filled rows or idle deterministic profile fields.
 */
export function shouldShowGenerateWithAiButton(
  row: FieldState,
  detected: DetectedField | undefined,
): boolean {
  if (!detected || !isTextLikeControl(row.inputType ?? detected.inputType)) return false;
  if (row.status === "filled") return false;

  const ft = detected.fieldType;
  const idleOrQueued =
    row.status === "idle" || row.status === "queued" || row.status === "loading";

  if (idleOrQueued && DETERMINISTIC_PROFILE_FIELD_TYPES.has(ft)) return false;

  if (
    row.status === "skipped" ||
    row.status === "failed" ||
    row.status === "manual_required"
  ) {
    return true;
  }

  if (row.isOpenEnded) return true;

  if (idleOrQueued) {
    return (
      ft === "unknown" ||
      ft === "short_text" ||
      ft === "long_text" ||
      ft === "openEnded" ||
      ft === "hearAbout"
    );
  }

  return false;
}
