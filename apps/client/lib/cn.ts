/** Join class names; falsy values omitted (no tailwind-merge — keep overrides explicit). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
