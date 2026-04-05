import type { ParsedJobDescription } from "../../lib/api";
import {
  DISPLAY_SECTION_KEYS,
  type DisplaySectionKey,
} from "../../lib/resolveJobDetailSections";
import { JobSection } from "./JobSection";

interface Props {
  sections: ParsedJobDescription;
}

const SECTION_TITLES: Record<DisplaySectionKey, string> = {
  responsibility: "Responsibilities",
  requirement: "Requirements",
  experience: "Experience",
  benefit: "Benefits",
  contact: "Contact",
  other: "Additional details",
};

function hasAnySection(s: ParsedJobDescription): boolean {
  return DISPLAY_SECTION_KEYS.some((k) => s[k].length > 0);
}

export function JobParsedContent({ sections }: Props) {
  if (!hasAnySection(sections)) {
    return <p className="text-sm text-ink/55">No role description available yet.</p>;
  }
  return (
    <div className="space-y-0">
      {DISPLAY_SECTION_KEYS.map((key) => (
        <JobSection key={key} title={SECTION_TITLES[key]} items={sections[key]} />
      ))}
    </div>
  );
}
