export const SEO_LOCATION_ALIASES: Record<string, string> = {
  "united-states": "usa",
  us: "usa",
  america: "usa",
  "united-kingdom": "uk",
  britain: "uk",
  "great-britain": "uk",
  "united-arab-emirates": "uae",
  deutschland: "germany",
};

export const SEO_DIMENSIONS = {
  roles: [] as string[],
  locations: [
    "remote",
    "india",
    "usa",
    "uk",
    "europe",
    "canada",
    "australia",
    "germany",
    "france",
    "netherlands",
    "spain",
    "italy",
    "sweden",
    "poland",
    "singapore",
    "uae",
    "japan",
    "brazil",
    "mexico",
    "south-africa",
  ],
  experience: ["0-2-years", "3-5-years", "6-plus-years"],
  workTypes: ["remote", "hybrid", "onsite"],
  postedWindows: ["24h", "3d", "1w", "1m"],
} as const;

const LOCATION_TO_COUNTRY: Record<string, string> = {
  india: "IN",
  usa: "US",
  uk: "GB",
  canada: "CA",
  australia: "AU",
  germany: "DE",
  france: "FR",
  netherlands: "NL",
  spain: "ES",
  italy: "IT",
  sweden: "SE",
  poland: "PL",
  singapore: "SG",
  uae: "AE",
  japan: "JP",
  brazil: "BR",
  mexico: "MX",
  "south-africa": "ZA",
};

export function locationTokenToFilter(token: string): {
  country?: string;
  location?: string;
  workType?: "remote" | "onsite" | "hybrid";
  isRemote?: boolean;
} {
  const raw = token.trim().toLowerCase();
  const t = SEO_LOCATION_ALIASES[raw] ?? raw;
  if (t === "remote") {
    return { workType: "remote", isRemote: true };
  }
  if (t === "hybrid") return { workType: "hybrid" };
  if (t === "onsite") return { workType: "onsite" };
  if (t === "europe") return { location: "europe" };
  const country = LOCATION_TO_COUNTRY[t];
  if (country) return { country };
  return { location: t };
}

export function experienceSlugToLevel(
  slug: string,
): "junior" | "mid" | "senior" | undefined {
  const s = slug.trim().toLowerCase();
  if (s === "0-2-years") return "junior";
  if (s === "3-5-years") return "mid";
  if (s === "6-plus-years") return "senior";
  return undefined;
}
