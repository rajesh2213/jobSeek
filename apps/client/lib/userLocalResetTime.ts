/**
 * User-local copy for “quota resets at …” lines. Uses the browser’s time zone
 * (the user’s region) instead of a fixed UTC label or a raw offset like "GMT+5:30"
 * from {@link Intl} `timeZoneName: "short"`.
 */

/** Wall-clock time in the user’s local time zone. */
export function formatUserLocalResetDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A regional / named zone (e.g. "India Standard Time", "Eastern Time"), not
 * a numeric GMT offset, when the engine supports it.
 */
export function getUserLocalTimeZoneLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  for (const timeZoneName of ["longGeneric", "long"] as const) {
    try {
      const part = new Intl.DateTimeFormat(undefined, { timeZoneName })
        .formatToParts(d)
        .find((p) => p.type === "timeZoneName");
      const v = part?.value?.trim();
      if (v) return v;
    } catch {
      // Very old runtimes: fall through
    }
  }

  return Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ");
}

/** Single line for toasts / API errors: local time + regional zone name. */
export function formatUserLocalResetForMessage(iso: string): string {
  const dt = formatUserLocalResetDateTime(iso);
  const z = getUserLocalTimeZoneLabel(iso);
  if (!dt) return iso.trim();
  return z ? `${dt} (${z})` : dt;
}
