import countries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json" with { type: "json" };

countries.registerLocale(enLocale as Parameters<typeof countries.registerLocale>[0]);

export interface CountryRecord {
  code: string;
  name: string;
  slug: string;
}

function slugifyCountryName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const names = countries.getNames("en", { select: "official" }) as Record<string, string>;

export const COUNTRY_LIST: CountryRecord[] = Object.entries(names).map(([code, name]) => ({
  code,
  name,
  slug: slugifyCountryName(name),
}));

export const VALID_COUNTRY_CODES = new Set(COUNTRY_LIST.map((c) => c.code));

/** Messy ATS strings → ISO 3166-1 alpha-2. Keys lowercase. */
export const COUNTRY_ALIAS_MAP: Record<string, string> = {
  usa: "US",
  us: "US",
  "united states": "US",
  "united states of america": "US",
  uae: "AE",
  uk: "GB",
  "united kingdom": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  india: "IN",
  bharat: "IN",
  bangalore: "IN",
  bengaluru: "IN",
  canada: "CA",
  australia: "AU",
  germany: "DE",
  deutschland: "DE",
  france: "FR",
  japan: "JP",
  china: "CN",
  brazil: "BR",
  mexico: "MX",
  singapore: "SG",
  netherlands: "NL",
  holland: "NL",
  spain: "ES",
  italy: "IT",
  "south korea": "KR",
  korea: "KR",
  "new zealand": "NZ",
  ireland: "IE",
  switzerland: "CH",
  sweden: "SE",
  poland: "PL",
  "south africa": "ZA",
  nigeria: "NG",
  egypt: "EG",
  "saudi arabia": "SA",
  "united arab emirates": "AE",
  dubai: "AE",
};

export const SORTED_ALIAS_KEYS = Object.keys(COUNTRY_ALIAS_MAP).sort((a, b) => b.length - a.length);

export function isValidCountryCode(code: string): boolean {
  return code === "UNKNOWN" || VALID_COUNTRY_CODES.has(code.toUpperCase());
}

export function resolveCountryCodeFromAlias(fragment: string): string | undefined {
  const k = fragment.trim().toLowerCase();
  return COUNTRY_ALIAS_MAP[k];
}

/**
 * Typeahead: prefix match first, then substring, alphabetical. Limit 15.
 */
export function searchCountries(query: string, limit = 15): CountryRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...COUNTRY_LIST].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  }

  const scored = COUNTRY_LIST.map((c) => {
    const nameLower = c.name.toLowerCase();
    const slugLower = c.slug.toLowerCase();
    let score = 999;
    if (c.code.toLowerCase() === q) score = 0;
    else if (nameLower.startsWith(q)) score = 1;
    else if (slugLower.startsWith(q)) score = 2;
    else if (nameLower.includes(q) || slugLower.includes(q)) score = 3;
    return { c, score };
  })
    .filter((x) => x.score < 999)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.c.name.localeCompare(b.c.name);
    })
    .slice(0, limit)
    .map((x) => x.c);

  return scored;
}

export function tryResolveCountryInput(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  if (/^[A-Za-z]{2}$/.test(t)) {
    const code = t.toUpperCase();
    if (VALID_COUNTRY_CODES.has(code)) return code;
  }
  const slug = slugifyCountryName(t);
  for (const c of COUNTRY_LIST) {
    if (c.slug === slug) return c.code;
  }
  const fromAlias = resolveCountryCodeFromAlias(t);
  if (fromAlias) return fromAlias;
  const g = countries.getAlpha2Code(t, "en");
  if (g && VALID_COUNTRY_CODES.has(g)) return g;
  return undefined;
}
