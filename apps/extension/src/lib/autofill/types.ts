export type FieldType =
  | "email"
  | "phone"
  | "linkedin"
  | "github"
  | "salary"
  | "boolean"
  | "select"
  | "short_text"
  | "long_text"
  | "fullName"
  | "firstName"
  | "lastName"
  | "location"
  | "address"
  | "city"
  | "country"
  | "zipCode"
  | "portfolio"
  | "website"
  | "currentTitle"
  | "currentCompany"
  | "yearsExperience"
  | "availability"
  | "workAuthorization"
  | "pronouns"
  | "hearAbout"
  | "resume"
  | "coverLetter"
  | "openEnded"
  | "unknown";

export type FieldValueSource = "mapping" | "ai" | "fallback";

export type FieldConfidence = "high" | "medium" | "low";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldContext {
  label: string;
  questionText: string;
  groupLabel: string;
  sectionLabel: string;
  options: string[];
  hintText: string;
}

export interface FieldMetadata {
  id: string;
  label: string;
  placeholder: string;
  name: string;
  inputType: string;
  required: boolean;
  options: FieldOption[];
  nearbyText: string;
  context: FieldContext;
  selector: string;
  groupKey?: string;
  charLimit?: number;
  questionHash?: string;
}

export interface ClassifiedField extends FieldMetadata {
  fieldType: FieldType;
  isOpenEnded: boolean;
  classificationSource: "rule" | "fallback";
}

