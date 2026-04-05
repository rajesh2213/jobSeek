import type { AxiosInstance } from "axios";
import he from "he";
import type { ParsedJobDescriptionAI } from "./ai.types.js";

const LINE_HINT_PREFIX_RE = /^\s*\[(?:OTHER|REQUIREMENTS)\]\s*/i;

/**
 * Removes bracket-prefixed classifier hints from persisted lines. Hints may repeat.
 */
export function stripHintPrefixes(lines: string[]): string[] {
  return lines
    .map((line) => {
      let s = line.trim();
      let prev = "";
      while (s !== prev) {
        prev = s;
        s = s.replace(LINE_HINT_PREFIX_RE, "").trim();
      }
      return s;
    })
    .filter((s) => s.length > 0);
}

export function stripParsedDescriptionHints(
  parsed: ParsedJobDescriptionAI,
): ParsedJobDescriptionAI {
  return {
    position: stripHintPrefixes(parsed.position),
    responsibility: stripHintPrefixes(parsed.responsibility),
    requirement: stripHintPrefixes(parsed.requirement),
    experience: stripHintPrefixes(parsed.experience),
    benefit: stripHintPrefixes(parsed.benefit),
    contact: stripHintPrefixes(parsed.contact),
    other: stripHintPrefixes(parsed.other),
  };
}

/** Decode HTML entities on classifier output lines before DB persistence. */
function decodePersistedLine(line: string): string {
  let s = he.decode(line);
  s = s.replace(/&nbsp;/gi, " ");
  s = s.replace(/\u00a0/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function decodePersistedParsedLines(parsed: ParsedJobDescriptionAI): ParsedJobDescriptionAI {
  const bucket = (lines: string[]) =>
    lines.map(decodePersistedLine).filter((x) => x.length > 0);
  return {
    position: bucket(parsed.position),
    responsibility: bucket(parsed.responsibility),
    requirement: bucket(parsed.requirement),
    experience: bucket(parsed.experience),
    benefit: bucket(parsed.benefit),
    contact: bucket(parsed.contact),
    other: bucket(parsed.other),
  };
}

/**
 * POST preprocessed job text to the inference service. Text must use newline-separated lines
 * so the Python worker runs batched classification per line.
 */
export async function postJobDescriptionParse(
  descriptionWithLineBreaks: string,
  client: AxiosInstance,
): Promise<unknown> {
  const trimmed = descriptionWithLineBreaks.trim();
  if (!trimmed) {
    return null;
  }
  const { data } = await client.post<unknown>("/parse", {
    description: trimmed,
  });
  return data;
}
