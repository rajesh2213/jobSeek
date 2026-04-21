"use client";

import {
  formatUserLocalResetDateTime,
  getUserLocalTimeZoneLabel,
} from "../../lib/userLocalResetTime";

type Props = {
  /** ISO 8601 instant when the cap resets. */
  iso: string;
  className?: string;
  /** e.g. job detail: muted caption */
  muted?: boolean;
};

/**
 * “Resets (Eastern Time) Wed, Apr 22, …” using the visitor’s time zone and a
 * named regional zone, not a fixed UTC line or a raw GMT offset.
 */
export function UserLocalResetCaption({ iso, className, muted }: Props) {
  const tz = getUserLocalTimeZoneLabel(iso);
  const line = formatUserLocalResetDateTime(iso);
  if (!line) return null;
  const tzClass = muted ? "text-ink/50" : "text-ink/45";
  return (
    <p className={className} suppressHydrationWarning>
      Resets
      {tz ? (
        <span className={tzClass}>
          {" "}
          ({tz})
        </span>
      ) : null}{" "}
      {line}
    </p>
  );
}
