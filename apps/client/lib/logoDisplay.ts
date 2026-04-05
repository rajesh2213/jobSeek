/** Larger Clearbit asset for crisp ~40–48px UI slots. */
export function companyLogoSrcForDisplay(logo: string): string {
  const base = logo.trim();
  if (!base) return base;
  if (base.includes("logo.clearbit.com")) {
    try {
      const u = new URL(base);
      u.searchParams.set("size", "80");
      return u.toString();
    } catch {
      return base.includes("?") ? `${base}&size=80` : `${base}?size=80`;
    }
  }
  return base;
}
