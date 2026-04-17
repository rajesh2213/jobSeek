import type { ClassifiedField, FieldMetadata, FieldType } from "./types";

/**
 * Order matters: ATS containers repeat the whole form in `questionText`, so "Phone" / "Email"
 * from sibling rows must not win over "First name" when matching on that blob. Put identity
 * fields before contact fields, and never match phone/email/linkedin/github on hayFull alone
 * (see `matchContactPattern`).
 */
const CONTACT_PATTERNS: Array<{ type: FieldType; re: RegExp }> = [
  { type: "fullName", re: /\b(full name|applicant name|legal name)\b/i },
  { type: "firstName", re: /\b(first name|given name)\b/i },
  { type: "lastName", re: /\b(last name|surname|family name)\b/i },
  {
    type: "currentTitle",
    re: /\b(job title|current title|position title|role title|your title|title at)\b/i,
  },
  {
    type: "currentCompany",
    re: /\b(company|employer|organization|company name|current company|current employer)\b/i,
  },
  {
    type: "location",
    re: /\b(location|application location|work location|where are you located|office location|current location|based in|start typing)\b/i,
  },
  { type: "country", re: /\b(country|country of residence|passport country)\b/i },
  { type: "city", re: /\bcity\b/i },
  { type: "workAuthorization", re: /\b(work authorization|authorized to work|visa sponsorship)\b/i },
  { type: "availability", re: /\b(availability|start date|notice period)\b/i },
  { type: "pronouns", re: /\bpronouns?\b/i },
  { type: "hearAbout", re: /\b(how did you hear|where did you hear|hear about)\b/i },
  { type: "resume", re: /\b(resume|curriculum vitae|upload cv|upload resume)\b/i },
  { type: "coverLetter", re: /\b(cover letter|motivation letter)\b/i },
  { type: "salary", re: /\b(expected salary|salary expectation|desired salary|compensation|pay)\b/i },
  { type: "email", re: /\b(email|e-mail)\b/i },
  { type: "phone", re: /\b(phone|mobile|telephone|cell)\b/i },
  { type: "linkedin", re: /\blinkedin\b/i },
  { type: "github", re: /\bgithub\b/i },
  { type: "portfolio", re: /\b(portfolio|personal website|website url|homepage)\b/i },
];

const STRICT_LOCAL_TYPES: FieldType[] = ["email", "phone", "linkedin", "github"];

/** Field-local copy only — never use the bloated container `questionText` here. */
function buildNarrowHay(field: FieldMetadata): string {
  return [
    field.label,
    field.placeholder,
    field.name,
    field.nearbyText,
    field.context.groupLabel,
    field.context.sectionLabel,
    field.context.hintText,
    field.context.options.join(" "),
  ]
    .join(" ")
    .trim();
}

/**
 * Essay / long-form prompts. Uses narrow hay only so sibling questions in the same DOM
 * container do not mark "Company" or "LinkedIn URL" as open-ended.
 */
function looksLikeLongQuestion(narrowHay: string): boolean {
  if (!narrowHay) return false;
  if (/\?/.test(narrowHay)) {
    return /(describe|tell us|explain|walk us through|why|how would|what (?:is your|was your|are your|would you)|elaborate|detail)/i.test(
      narrowHay,
    );
  }
  return /(describe|tell us|explain|walk us through|contribution|postgres|founder|referrer)/i.test(narrowHay);
}

/** Do not resolve title/company from the full container blob — avoids essay prompts mentioning "company". */
const TITLE_COMPANY_TYPES: FieldType[] = ["currentTitle", "currentCompany"];

/** Never classify from container-only hay — sibling "Phone" / "Email" / "LinkedIn" labels leak into every field. */
const CONTACT_TYPES_FULL_HAY_EXCLUDED: FieldType[] = ["email", "phone", "linkedin", "github"];

function matchContactPattern(narrowHay: string, hayFull: string): (typeof CONTACT_PATTERNS)[number] | undefined {
  const fromNarrow = CONTACT_PATTERNS.find((p) => p.re.test(narrowHay));
  if (fromNarrow) return fromNarrow;
  return CONTACT_PATTERNS.find(
    (p) =>
      p.re.test(hayFull) &&
      !TITLE_COMPANY_TYPES.includes(p.type) &&
      !CONTACT_TYPES_FULL_HAY_EXCLUDED.includes(p.type),
  );
}

export function classifyField(field: FieldMetadata): ClassifiedField {
  const localHay = [field.label, field.placeholder, field.name].join(" ").trim();
  const narrowHay = buildNarrowHay(field);
  const hayFull = `${narrowHay} ${field.context.questionText}`.trim();
  const hay = hayFull;
  const inputType = field.inputType.toLowerCase();

  if (inputType === "email") {
    return { ...field, fieldType: "email", isOpenEnded: false, classificationSource: "rule" };
  }
  if (inputType === "tel") {
    return { ...field, fieldType: "phone", isOpenEnded: false, classificationSource: "rule" };
  }
  if (inputType === "file") {
    return { ...field, fieldType: "resume", isOpenEnded: false, classificationSource: "rule" };
  }
  if (inputType === "checkbox" || inputType === "radio") {
    // Per-option hay is often just "LinkedIn" / "Notion Website" — use group + question context
    // so we classify the whole group as hearAbout, not as linkedin/github/etc.
    const groupHay = [
      field.context.groupLabel,
      field.context.questionText,
      field.context.sectionLabel,
      field.label,
      field.placeholder,
      field.name,
      hay,
    ]
      .join(" ")
      .toLowerCase();
    const isHearAboutGroup =
      /\b(how did you hear|where did you hear|hear about|hear about this|where did you find)\b/i.test(groupHay) ||
      /\b(vacancy source|referral source|application source)\b/i.test(groupHay) ||
      (/\bselect all that apply\b/i.test(groupHay) &&
        /\b(linkedin|glassdoor|indeed|website|blog|employee|referral|billboard|conference|meetup|newsletter)\b/i.test(
          groupHay,
        ));

    if (isHearAboutGroup) {
      return { ...field, fieldType: "hearAbout", isOpenEnded: false, classificationSource: "rule" };
    }

    const type = /\b(yes|no|true|false)\b/i.test(hay) ? "boolean" : "unknown";
    const byContent = matchContactPattern(narrowHay, hayFull);
    if (/\b(hear about|vacancy source|source)\b/i.test(hay)) {
      return { ...field, fieldType: "hearAbout", isOpenEnded: false, classificationSource: "rule" };
    }
    return {
      ...field,
      fieldType: byContent?.type ?? type,
      isOpenEnded: false,
      classificationSource: "rule",
    };
  }
  if (inputType === "select-one" || inputType === "select") {
    const byContent = matchContactPattern(narrowHay, hayFull);
    return {
      ...field,
      fieldType: byContent?.type ?? "select",
      isOpenEnded: false,
      classificationSource: byContent ? "rule" : "fallback",
    };
  }

  const textLike = inputType === "textarea" || inputType === "text" || inputType === "search";

  // Generic "name" field → fullName, but only when not clearly first/last/email/company/etc.
  if (
    textLike &&
    /\bname\b/i.test(field.label || field.name) &&
    !/\b(first|last|email|company|employer|manager)\b/i.test(field.label || "") &&
    !/\b(source|hear about|where did you hear)\b/i.test(hay)
  ) {
    return { ...field, fieldType: "fullName", isOpenEnded: false, classificationSource: "rule" };
  }

  for (const strictType of STRICT_LOCAL_TYPES) {
    const pattern = CONTACT_PATTERNS.find((p) => p.type === strictType);
    if (pattern?.re.test(localHay)) {
      return { ...field, fieldType: strictType, isOpenEnded: false, classificationSource: "rule" };
    }
  }

  if (textLike) {
    const locHay = [narrowHay, field.context.questionText].join(" ").toLowerCase();
    if (
      /\b(location|application location|work location|where are you located|where are you based|current location|office location|located in)\b/i.test(
        locHay,
      ) &&
      !/\b(linkedin|github|portfolio)\b.*\b(url|profile|link)\b/i.test(locHay)
    ) {
      return { ...field, fieldType: "location", isOpenEnded: false, classificationSource: "rule" };
    }
  }

  if (/\b(referral|referrer)\b/i.test(hay)) {
    return { ...field, fieldType: "short_text", isOpenEnded: false, classificationSource: "rule" };
  }
  if (/\b(previous founder|over the age of 18|over 18|visa sponsorship|work authorization)\b/i.test(hay)) {
    return { ...field, fieldType: "boolean", isOpenEnded: false, classificationSource: "rule" };
  }
  if (/\b(source|hear about|where did you hear)\b/i.test(hay)) {
    return { ...field, fieldType: "hearAbout", isOpenEnded: false, classificationSource: "rule" };
  }

  const byPattern = matchContactPattern(narrowHay, hayFull);
  if (byPattern) {
    return { ...field, fieldType: byPattern.type, isOpenEnded: false, classificationSource: "rule" };
  }

  if (textLike && looksLikeLongQuestion(narrowHay)) {
    return { ...field, fieldType: "openEnded", isOpenEnded: true, classificationSource: "rule" };
  }

  if (inputType === "textarea") {
    return { ...field, fieldType: "long_text", isOpenEnded: false, classificationSource: "fallback" };
  }
  if (textLike) {
    return { ...field, fieldType: "short_text", isOpenEnded: false, classificationSource: "fallback" };
  }

  return { ...field, fieldType: "unknown", isOpenEnded: false, classificationSource: "fallback" };
}

export function classifyFields(fields: FieldMetadata[]): ClassifiedField[] {
  return fields.map(classifyField);
}

