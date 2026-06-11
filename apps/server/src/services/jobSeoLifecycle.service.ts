export type JobSeoLifecycleFields = {
  isActive?: boolean | null;
  expiresAt?: Date | string | null;
};

/** Mirrors client `shouldIndexJob` — inactive or past `expiresAt` is not SEO-active. */
export function isJobSeoActive(fields: JobSeoLifecycleFields, now: Date = new Date()): boolean {
  if (fields.isActive === false) return false;
  const raw = fields.expiresAt;
  if (raw == null || raw === "") return true;
  const ts = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));
  if (Number.isNaN(ts)) return true;
  return ts > now.getTime();
}
