import {
  MIN_ALIAS_LENGTH,
  SKILL_ALIAS_ENTRIES,
  type AliasMode,
  type SkillAliasEntry,
} from "./taxonomyEntries.js";

export {
  MIN_ALIAS_LENGTH,
  SKILL_ALIAS_ENTRIES,
  type AliasMode,
  type SkillAliasEntry,
} from "./taxonomyEntries.js";

for (const entry of SKILL_ALIAS_ENTRIES) {
  const len = entry.alias.replace(/[.\-#]/g, "").length;
  if (len < MIN_ALIAS_LENGTH && entry.mode !== "short-allow") {
    throw new Error(
      `SKILL_ALIAS_ENTRIES: alias "${entry.alias}" is ${len} chars (< MIN_ALIAS_LENGTH=${MIN_ALIAS_LENGTH}) ` +
        `but mode is "${entry.mode}". Short aliases MUST use mode "short-allow".`,
    );
  }
  if (entry.alias.includes(" ") && entry.mode !== "phrase" && entry.mode !== "short-allow") {
    throw new Error(
      `SKILL_ALIAS_ENTRIES: multi-word alias "${entry.alias}" should use mode "phrase", got "${entry.mode}".`,
    );
  }
}

export const SKILL_ALIAS_MAP: Record<string, string> = Object.fromEntries(
  SKILL_ALIAS_ENTRIES.map((e) => [e.alias, e.canonical]),
);

export const KNOWN_SKILL_SLUGS = Array.from(new Set(Object.values(SKILL_ALIAS_MAP))).sort();

export function isKnownSkillSlug(slug: string): boolean {
  return KNOWN_SKILL_SLUGS.includes(slug);
}
