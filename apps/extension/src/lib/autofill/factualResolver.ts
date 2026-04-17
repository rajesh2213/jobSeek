import type { FieldConfidence, FieldType, FieldValueSource } from "./types";
import type { ApplyProfile } from "../formFiller";

export interface FactualMappingResult {
  value: string | null;
  confidence: FieldConfidence;
  source: FieldValueSource;
}

function yesNo(v: boolean): string {
  return v ? "Yes" : "No";
}

function isTruthyText(v: string | null | undefined): boolean {
  return Boolean(v && v.trim().length > 0);
}

export function resolveFactualField(
  field: {
    fieldType: FieldType | string;
    label: string;
    inputType?: string;
    options?: string[];
    questionText?: string;
    groupLabel?: string;
    sectionLabel?: string;
    hintText?: string;
  },
  profile: ApplyProfile,
): FactualMappingResult | null {
  const hay = [
    field.label,
    field.questionText,
    field.groupLabel,
    field.sectionLabel,
    field.hintText,
    ...(field.options ?? []),
  ]
    .join(" ")
    .toLowerCase();

  if (field.fieldType === "salary" || /\b(expected salary|salary expectation|desired salary)\b/.test(hay)) {
    if (isTruthyText(profile.salaryExpectation)) {
      return { value: String(profile.salaryExpectation).trim(), confidence: "high", source: "mapping" };
    }
  }

  if (/\b(previous founder)\b/.test(hay)) {
    return { value: yesNo(false), confidence: "medium", source: "fallback" };
  }
  if (/\b(over the age of 18|over 18|age of majority)\b/.test(hay)) {
    return { value: yesNo(true), confidence: "high", source: "fallback" };
  }
  if (/\b(work authorization|authorized to work)\b/.test(hay)) {
    return { value: yesNo(true), confidence: "medium", source: "fallback" };
  }
  if (/\b(visa sponsorship|sponsorship required|require sponsorship)\b/.test(hay)) {
    return { value: yesNo(false), confidence: "medium", source: "fallback" };
  }
  if (/\b(referrer name|referral name)\b/.test(hay)) {
    return { value: "", confidence: "high", source: "fallback" };
  }

  return null;
}

