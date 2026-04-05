import type { AccentTone } from "../components/ui/types";

const TONES: AccentTone[] = ["teal", "rose", "amber", "brand"];

/** Deterministic accent for list rows (Komposo-style rotating rail colors). */
export function accentFromId(id: string): AccentTone {
  let h = 0;
  for (let i = 0; i < id.length; i++) h += id.charCodeAt(i);
  return TONES[Math.abs(h) % TONES.length];
}
