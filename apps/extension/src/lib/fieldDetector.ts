import { classifyFields } from "./autofill/classify";
import { extractFieldMetadata } from "./autofill/extract";
import type { FieldType } from "./autofill/types";

export interface DetectedField {
  id: string;
  /** Iframe target from multi-frame scan; omit on single-frame / in-frame detection. */
  frameId?: number;
  /** Original data-jsa-id within that frame; set with composite `id` when `frameId` is set. */
  localId?: string;
  fieldType: FieldType;
  label: string;
  questionText?: string;
  groupLabel?: string;
  sectionLabel?: string;
  options?: string[];
  hintText?: string;
  questionHash?: string;
  isRequired: boolean;
  isOpenEnded: boolean;
  elementSelector: string;
  inputType?: string;
  groupKey?: string;
  charLimit?: number;
}

export function detectFormFields(): DetectedField[] {
  const extracted = extractFieldMetadata();
  const classified = classifyFields(extracted);
  return classified.map((f) => ({
    id: f.id,
    fieldType: f.fieldType,
    label: f.label,
    questionText: f.context.questionText,
    groupLabel: f.context.groupLabel,
    sectionLabel: f.context.sectionLabel,
    options: f.context.options,
    hintText: f.context.hintText,
    questionHash: f.questionHash,
    isRequired: f.required,
    isOpenEnded: f.isOpenEnded,
    elementSelector: f.selector,
    inputType: f.inputType,
    groupKey: f.groupKey,
    charLimit: f.charLimit,
  }));
}
