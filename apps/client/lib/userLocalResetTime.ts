/**
 * User-local copy for “quota resets at …” lines.
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
 * Prefer short timezone labels (e.g. "IST", "EST", "PDT").
 */
export function getUserLocalTimeZoneLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  for (const timeZoneName of ["short", "shortGeneric"] as const) {
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

  return "";
}

/** Single line for toasts / API errors: local time + regional zone name. */
export function formatUserLocalResetForMessage(iso: string): string {
  const dt = formatUserLocalResetDateTime(iso);
  const z = getUserLocalTimeZoneLabel(iso);
  if (!dt) return iso.trim();
  return z ? `${dt} (${z})` : dt;
}
