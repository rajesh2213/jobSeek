/**
 * Single source of truth for job location parsing, ISO country resolution, and region bucketing.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import countries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json" with { type: "json" };
import {
  COUNTRY_LIST,
  VALID_COUNTRY_CODES,
} from "../config/countries.js";

countries.registerLocale(enLocale as Parameters<typeof countries.registerLocale>[0]);

const ALL_ISO_CODES = Object.keys(
  countries.getNames("en", { select: "official" }) as Record<string, string>,
);

/** ISO alpha-2 → region (Middle East separate from Asia). */
export const REGION_MAP: Record<string, string> = (() => {
  const ME = new Set(
    "AE,SA,IL,QA,KW,BH,OM,JO,LB,IQ,IR,YE,SY,PS".split(",").filter(Boolean),
  );
  const EU = new Set(
    "AL,AD,AT,BY,BE,BA,BG,HR,CY,CZ,DK,EE,FI,FR,DE,GR,HU,IS,IE,IT,LV,LI,LT,LU,MT,MD,MC,ME,NL,MK,NO,PL,PT,RO,RU,SM,RS,SK,SI,ES,SE,CH,UA,GB,VA,AX,FO,GG,GI,IM,JE,SJ,XK".split(","),
  );
  const AF = new Set(
    "DZ,AO,BJ,BW,BF,BI,CV,CM,CF,TD,KM,CG,CD,DJ,EG,GQ,ER,SZ,ET,GA,GM,GH,GN,GW,KE,LS,LR,LY,MG,MW,ML,MR,MU,MZ,NA,NE,NG,RW,ST,SN,SC,SL,SO,ZA,SS,SD,TZ,TG,TN,UG,ZM,ZW,EH,SH,RE,YT,BI,SS".split(
      ",",
    ),
  );
  const NA = new Set(
    "US,CA,MX,GT,BZ,CR,SV,HN,NI,PA,CU,JM,HT,DO,TT,AG,BB,BS,DM,GD,KN,LC,VC,BM,KY,TC,VG,MS,AI,AW,BQ,CW,SX,BL,MF,GP,MQ,PM,GL,PM".split(","),
  );
  const SA = new Set("AR,BO,BR,CL,CO,EC,FK,GY,PY,PE,SR,UY,VE,GF".split(","));
  const OC = new Set(
    "AU,NZ,PG,FJ,SB,VU,NC,PF,WS,TO,KI,FM,MH,PW,NR,TV,GU,MP,AS,CK,NU,TK,WF,PN".split(","),
  );
  const m: Record<string, string> = {};
  for (const code of ALL_ISO_CODES) {
    if (ME.has(code)) m[code] = "Middle East";
    else if (EU.has(code)) m[code] = "Europe";
    else if (AF.has(code)) m[code] = "Africa";
    else if (NA.has(code)) m[code] = "North America";
    else if (SA.has(code)) m[code] = "South America";
    else if (OC.has(code)) m[code] = "Oceania";
    else m[code] = "Asia";
  }
  return m;
})();

/** Lowercase alias / country name fragment → ISO alpha-2 (80+ entries). */
export const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  usa: "US",
  "united states": "US",
  "united states of america": "US",
  america: "US",
  uae: "AE",
  dubai: "AE",
  "abu dhabi": "AE",
  uk: "GB",
  "united kingdom": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  ireland: "IE",
  "northern ireland": "GB",
  india: "IN",
  bharat: "IN",
  china: "CN",
  japan: "JP",
  germany: "DE",
  deutschland: "DE",
  france: "FR",
  italy: "IT",
  spain: "ES",
  netherlands: "NL",
  holland: "NL",
  belgium: "BE",
  switzerland: "CH",
  austria: "AT",
  sweden: "SE",
  norway: "NO",
  denmark: "DK",
  finland: "FI",
  poland: "PL",
  portugal: "PT",
  greece: "GR",
  czechia: "CZ",
  "czech republic": "CZ",
  hungary: "HU",
  romania: "RO",
  bulgaria: "BG",
  croatia: "HR",
  serbia: "RS",
  slovakia: "SK",
  slovenia: "SI",
  lithuania: "LT",
  latvia: "LV",
  estonia: "EE",
  luxembourg: "LU",
  malta: "MT",
  cyprus: "CY",
  iceland: "IS",
  russia: "RU",
  ukraine: "UA",
  turkey: "TR",
  israel: "IL",
  "saudi arabia": "SA",
  qatar: "QA",
  kuwait: "KW",
  bahrain: "BH",
  oman: "OM",
  jordan: "JO",
  lebanon: "LB",
  iraq: "IQ",
  iran: "IR",
  pakistan: "PK",
  bangladesh: "BD",
  "sri lanka": "LK",
  nepal: "NP",
  singapore: "SG",
  malaysia: "MY",
  thailand: "TH",
  vietnam: "VN",
  indonesia: "ID",
  philippines: "PH",
  "south korea": "KR",
  korea: "KR",
  "north korea": "KP",
  taiwan: "TW",
  "hong kong": "HK",
  macau: "MO",
  mongolia: "MN",
  kazakhstan: "KZ",
  uzbekistan: "UZ",
  "new zealand": "NZ",
  australia: "AU",
  canada: "CA",
  mexico: "MX",
  brazil: "BR",
  argentina: "AR",
  chile: "CL",
  colombia: "CO",
  peru: "PE",
  venezuela: "VE",
  ecuador: "EC",
  "south africa": "ZA",
  nigeria: "NG",
  kenya: "KE",
  egypt: "EG",
  morocco: "MA",
  ghana: "GH",
  ethiopia: "ET",
  tanzania: "TZ",
  uganda: "UG",
  tunisia: "TN",
  algeria: "DZ",
};

/** Normalize keys to lowercase for lookup. */
const COUNTRY_NAME_KEYS_SORTED = Object.keys(COUNTRY_NAME_TO_CODE).sort(
  (a, b) => b.length - a.length,
);

/** Major cities (lowercase) → ISO alpha-2 (150+). */
export const CITY_TO_COUNTRY: Record<string, string> = Object.fromEntries(
  Object.entries({
    chennai: "IN",
    mumbai: "IN",
    bombay: "IN",
    bangalore: "IN",
    bengaluru: "IN",
    hyderabad: "IN",
    delhi: "IN",
    "new delhi": "IN",
    noida: "IN",
    gurgaon: "IN",
    gurugram: "IN",
    pune: "IN",
    kolkata: "IN",
    calcutta: "IN",
    ahmedabad: "IN",
    jaipur: "IN",
    kochi: "IN",
    coimbatore: "IN",
    indore: "IN",
    chandigarh: "IN",
    visakhapatnam: "IN",
    "new york": "US",
    "new york city": "US",
    nyc: "US",
    manhattan: "US",
    brooklyn: "US",
    "san francisco": "US",
    "los angeles": "US",
    chicago: "US",
    houston: "US",
    phoenix: "US",
    philadelphia: "US",
    sanantonio: "US",
    dallas: "US",
    "san diego": "US",
    "san jose": "US",
    austin: "US",
    jacksonville: "US",
    columbus: "US",
    charlotte: "US",
    indianapolis: "US",
    seattle: "US",
    denver: "US",
    boston: "US",
    detroit: "US",
    atlanta: "US",
    miami: "US",
    minneapolis: "US",
    tampa: "US",
    pittsburgh: "US",
    portland: "US",
    cincinnati: "US",
    sacramento: "US",
    kansas: "US",
    "salt lake": "US",
    "salt lake city": "US",
    "oklahoma city": "US",
    "kansas city": "US",
    "jersey city": "US",
    "atlantic city": "US",
    "rapid city": "US",
    nashville: "US",
    raleigh: "US",
    stlouis: "US",
    cleveland: "US",
    itasca: "US",
    huntsville: "US",
    london: "GB",
    manchester: "GB",
    edinburgh: "GB",
    birmingham: "GB",
    dublin: "IE",
    berlin: "DE",
    munich: "DE",
    frankfurt: "DE",
    hamburg: "DE",
    amsterdam: "NL",
    rotterdam: "NL",
    paris: "FR",
    lyon: "FR",
    stockholm: "SE",
    zurich: "CH",
    geneva: "CH",
    vienna: "AT",
    warsaw: "PL",
    prague: "CZ",
    barcelona: "ES",
    madrid: "ES",
    rome: "IT",
    milan: "IT",
    brussels: "BE",
    copenhagen: "DK",
    helsinki: "FI",
    oslo: "NO",
    lisbon: "PT",
    athens: "GR",
    bucharest: "RO",
    budapest: "HU",
    singapore: "SG",
    tokyo: "JP",
    osaka: "JP",
    seoul: "KR",
    busan: "KR",
    beijing: "CN",
    shanghai: "CN",
    shenzhen: "CN",
    guangzhou: "CN",
    hangzhou: "CN",
    chengdu: "CN",
    nanjing: "CN",
    wuhan: "CN",
    xian: "CN",
    hongkong: "HK",
    taipei: "TW",
    kaohsiung: "TW",
    sydney: "AU",
    melbourne: "AU",
    brisbane: "AU",
    perth: "AU",
    auckland: "NZ",
    wellington: "NZ",
    toronto: "CA",
    vancouver: "CA",
    montreal: "CA",
    calgary: "CA",
    ottawa: "CA",
    mexico: "MX",
    "mexico city": "MX",
    saopaulo: "BR",
    rio: "BR",
    buenosaires: "AR",
    santiago: "CL",
    bogota: "CO",
    lima: "PE",
    johannesburg: "ZA",
    capetown: "ZA",
    lagos: "NG",
    nairobi: "KE",
    cairo: "EG",
    telaviv: "IL",
    dubai: "AE",
    doha: "QA",
    riyadh: "SA",
    manama: "BH",
    muscat: "OM",
    kuwait: "KW",
    abudhabi: "AE",
    sharjah: "AE",
    jakarta: "ID",
    bangkok: "TH",
    hochiminh: "VN",
    "ho chi minh city": "VN",
    hanoi: "VN",
    manila: "PH",
    kualalumpur: "MY",
    karachi: "PK",
    lahore: "PK",
    dhaka: "BD",
    colombo: "LK",
    kathmandu: "NP",
    yokohama: "JP",
    kyoto: "JP",
    fukuoka: "JP",
    nagoya: "JP",
    sapporo: "JP",
    adelaide: "AU",
    canberra: "AU",
    montevideo: "UY",
    caracas: "VE",
    panama: "PA",
    sanjose: "CR",
    guatemala: "GT",
    "guatemala city": "GT",
    quito: "EC",
    casablanca: "MA",
    tunis: "TN",
    algiers: "DZ",
    accra: "GH",
    addisababa: "ET",
    kampala: "UG",
    dar: "TZ",
    lusaka: "ZM",
    harare: "ZW",
    penang: "MY",
    johor: "MY",
    surat: "IN",
    vadodara: "IN",
    lucknow: "IN",
    nagpur: "IN",
    bhopal: "IN",
    patna: "IN",
    ludhiana: "IN",
    amritsar: "IN",
    guwahati: "IN",
    ranchi: "IN",
    bhubaneswar: "IN",
    thiruvananthapuram: "IN",
    madurai: "IN",
    mysore: "IN",
    mangalore: "IN",
    trichy: "IN",
    vizag: "IN",
    orlando: "US",
    lasvegas: "US",
    sandiego: "US",
    baltimore: "US",
    milwaukee: "US",
    albuquerque: "US",
    tucson: "US",
    fresno: "US",
    mesa: "US",
    omaha: "US",
    oakland: "US",
    wichita: "US",
    arlington: "US",
    stockton: "US",
    istanbul: "TR",
    haifa: "IL",
    jerusalem: "IL",
    bratislava: "SK",
    ljubljana: "SI",
    zagreb: "HR",
    belgrade: "RS",
    sofia: "BG",
    tallinn: "EE",
    riga: "LV",
    vilnius: "LT",
    goldcoast: "AU",
    hobart: "AU",
    edmonton: "CA",
    winnipeg: "CA",
    quebec: "CA",
    hamilton: "CA",
    victoria: "CA",
    mississauga: "CA",
    medellin: "CO",
    cordoba: "AR",
    rosario: "AR",
    guadalajara: "MX",
    monterrey: "MX",
    tijuana: "MX",
    puebla: "MX",
    curitiba: "BR",
    portoalegre: "BR",
    recife: "BR",
    fortaleza: "BR",
    salvador: "BR",
    belohorizonte: "BR",
    antwerp: "BE",
    cologne: "DE",
    stuttgart: "DE",
    dusseldorf: "DE",
    leipzig: "DE",
    bordeaux: "FR",
    toulouse: "FR",
    marseille: "FR",
    nice: "FR",
    turin: "IT",
    naples: "IT",
    florence: "IT",
    valencia: "ES",
    seville: "ES",
    bilbao: "ES",
    gothenburg: "SE",
    malmo: "SE",
    trondheim: "NO",
    bergen: "NO",
    krakow: "PL",
    wroclaw: "PL",
    gdansk: "PL",
    brno: "CZ",
    odesa: "UA",
    kharkiv: "UA",
    minsk: "BY",
    tashkent: "UZ",
    almaty: "KZ",
    astana: "KZ",
    baku: "AZ",
    tbilisi: "GE",
    yerevan: "AM",
    phnompenh: "KH",
    vientiane: "LA",
    yangon: "MM",
    hochiminhcity: "VN",
    surabaya: "ID",
    bandung: "ID",
    cebu: "PH",
    "quezon city": "PH",
    davao: "PH",
    brunei: "BN",
    portmoresby: "PG",
    nadi: "FJ",
    christchurch: "NZ",
    hamiltonnz: "NZ",
    durban: "ZA",
    pretoria: "ZA",
    abuja: "NG",
    kano: "NG",
    marrakech: "MA",
    alexandria: "EG",
    giza: "EG",
    mombasa: "KE",
    kigali: "RW",
    dakar: "SN",
    abidjan: "CI",
    douala: "CM",
    luanda: "AO",
    maputo: "MZ",
    windhoek: "NA",
    gaborone: "BW",
  }).map(([k, v]) => [k.toLowerCase(), v]),
);

export const US_STATES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

export const IN_STATES: Record<string, string> = {
  AP: "Andhra Pradesh",
  AR: "Arunachal Pradesh",
  AS: "Assam",
  BR: "Bihar",
  CT: "Chhattisgarh",
  GA: "Goa",
  GJ: "Gujarat",
  HR: "Haryana",
  HP: "Himachal Pradesh",
  JH: "Jharkhand",
  KA: "Karnataka",
  KL: "Kerala",
  MP: "Madhya Pradesh",
  MH: "Maharashtra",
  MN: "Manipur",
  ML: "Meghalaya",
  MZ: "Mizoram",
  NL: "Nagaland",
  OR: "Odisha",
  PB: "Punjab",
  RJ: "Rajasthan",
  SK: "Sikkim",
  TN: "Tamil Nadu",
  TG: "Telangana",
  TR: "Tripura",
  UP: "Uttar Pradesh",
  UT: "Uttarakhand",
  WB: "West Bengal",
  AN: "Andaman and Nicobar Islands",
  CH: "Chandigarh",
  DN: "Dadra and Nagar Haveli and Daman and Diu",
  DL: "Delhi",
  JK: "Jammu and Kashmir",
  LA: "Ladakh",
  LD: "Lakshadweep",
  PY: "Puducherry",
};

const IN_STATE_BY_LOWER = new Map<string, string>(
  Object.values(IN_STATES).map((name) => [name.toLowerCase(), name]),
);

export type ResolvedLocation = {
  city: string | null;
  state: string | null;
  country: string;
  region: string | null;
  isRemote: boolean;
};

function titleCaseWords(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function regionForCountry(code: string): string | null {
  if (!code || code === "UNKNOWN") return null;
  return REGION_MAP[code] ?? null;
}

function tryIsoCodeToken(t: string): string | undefined {
  const u = t.trim().toUpperCase();
  if (u.length === 2 && VALID_COUNTRY_CODES.has(u)) return u;
  return undefined;
}

/** US state full name (lowercase) → official full name string (same as US_STATES values). */
const US_STATE_FULL_NAME_BY_LOWER: Map<string, string> = new Map(
  Object.values(US_STATES).map((name) => [name.toLowerCase(), name]),
);

const CA_PROVINCE_FULL_NAMES = [
  "Alberta",
  "British Columbia",
  "Manitoba",
  "New Brunswick",
  "Newfoundland and Labrador",
  "Nova Scotia",
  "Ontario",
  "Prince Edward Island",
  "Quebec",
  "Saskatchewan",
  "Northwest Territories",
  "Nunavut",
  "Yukon",
] as const;

const CA_PROVINCE_BY_LOWER = new Map<string, string>(
  CA_PROVINCE_FULL_NAMES.map((n) => [n.toLowerCase(), n]),
);

const AU_STATE_FULL_NAMES = [
  "New South Wales",
  "Queensland",
  "South Australia",
  "Tasmania",
  "Victoria",
  "Western Australia",
  "Australian Capital Territory",
  "Northern Territory",
] as const;

const AU_STATE_BY_LOWER = new Map<string, string>(
  AU_STATE_FULL_NAMES.map((n) => [n.toLowerCase(), n]),
);

const UK_CONSTITUENT_BY_LOWER = new Map<string, string>([
  ["england", "England"],
  ["scotland", "Scotland"],
  ["wales", "Wales"],
  ["northern ireland", "Northern Ireland"],
]);

/** Minimal DE Land names (second segment) for EU postings. Keys: NFKD-normalized lowercase ASCII. */
const DE_REGION_BY_LOWER = new Map<string, string>([
  ["bavaria", "Bavaria"],
  ["baden-wurttemberg", "Baden-Württemberg"],
  ["baden-wuerttemberg", "Baden-Württemberg"],
  ["north rhine-westphalia", "North Rhine-Westphalia"],
  ["north rhine westphalia", "North Rhine-Westphalia"],
  ["lower saxony", "Lower Saxony"],
  ["rhineland-palatinate", "Rhineland-Palatinate"],
  ["rhineland palatinate", "Rhineland-Palatinate"],
  ["schleswig-holstein", "Schleswig-Holstein"],
  ["mecklenburg-vorpommern", "Mecklenburg-Vorpommern"],
  ["saxony-anhalt", "Saxony-Anhalt"],
  ["hesse", "Hesse"],
  ["thuringia", "Thuringia"],
  ["brandenburg", "Brandenburg"],
  ["berlin", "Berlin"],
  ["hamburg", "Hamburg"],
  ["bremen", "Bremen"],
  ["saarland", "Saarland"],
  ["saxony", "Saxony"],
]);

function normalizeSubnationalToken(s: string): string {
  return s
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * "City, FullRegionName" when the second segment is a known subnational area (not only 2-letter codes).
 */
function tryResolveCityCommaSubnationalRegion(
  seg1: string,
  seg2: string,
): { city: string; state: string | null; country: string } | null {
  const city = titleCaseWords(seg1.replace(/-/g, " "));
  const r = normalizeSubnationalToken(seg2);

  const usState = US_STATE_FULL_NAME_BY_LOWER.get(r);
  if (usState) {
    return { city, state: usState, country: "US" };
  }

  const caProv = CA_PROVINCE_BY_LOWER.get(r);
  if (caProv) {
    return { city, state: caProv, country: "CA" };
  }

  const auSt = AU_STATE_BY_LOWER.get(r);
  if (auSt) {
    return { city, state: auSt, country: "AU" };
  }

  const inSt = IN_STATE_BY_LOWER.get(r);
  if (inSt) {
    return { city, state: inSt, country: "IN" };
  }

  const uk = UK_CONSTITUENT_BY_LOWER.get(r);
  if (uk) {
    return { city, state: uk, country: "GB" };
  }

  const de = DE_REGION_BY_LOWER.get(r);
  if (de) {
    return { city, state: de, country: "DE" };
  }

  return null;
}

/** "Barcelona (ES)" → "Barcelona, ES" so comma-based city/country resolution applies. */
function normalizeParenthesizedCountryCode(text: string): string {
  const m = text.match(/^(.+?)\s*\(([A-Za-z]{2})\)\s*$/);
  if (!m) return text;
  const iso = tryIsoCodeToken(m[2]!);
  if (!iso) return text;
  return `${m[1]!.trim()}, ${iso}`;
}

/**
 * Parse free-text / ATS location lines into structured fields + ISO country.
 */
export function resolveLocation(raw: string): ResolvedLocation {
  const isRemote = /\bremote\b/i.test(raw);
  let text = raw
    .replace(/\bremote\b/gi, " ")
    .replace(/[-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[,;\s.|]+|[,;\s.|]+$/g, "")
    .trim();

  text = normalizeParenthesizedCountryCode(text);

  let city: string | null = null;
  let state: string | null = null;
  let country = "UNKNOWN";

  if (!text) {
    return { city: null, state: null, country: "UNKNOWN", region: null, isRemote };
  }

  const regionsList = getRegions();
  const regionOnly = regionsList.find((r) => r.toLowerCase() === text.toLowerCase());
  if (regionOnly) {
    return {
      city: null,
      state: null,
      country: "UNKNOWN",
      region: regionOnly,
      isRemote,
    };
  }

  const lowerFull = text.toLowerCase();
  const segments = text
    .split(/[,;/|]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 2) {
    const subEarly = tryResolveCityCommaSubnationalRegion(segments[0]!, segments[1]!);
    if (subEarly) {
      return {
        city: subEarly.city,
        state: subEarly.state,
        country: subEarly.country,
        region: regionForCountry(subEarly.country),
        isRemote,
      };
    }
  }

  const trail = text.match(/^(.+),\s*([A-Za-z]{2})\s*$/);
  if (trail) {
    const leftRaw = trail[1]!.trim();
    const right = trail[2]!.toUpperCase();
    const leftKey = leftRaw.toLowerCase().replace(/-/g, " ");
    const hint = CITY_TO_COUNTRY[leftKey];
    if (hint && hint === right && VALID_COUNTRY_CODES.has(right)) {
      country = right;
      city = titleCaseWords(leftRaw.replace(/-/g, " "));
    } else if (US_STATES[right]) {
      country = "US";
      state = US_STATES[right]!;
      city = titleCaseWords(leftRaw.replace(/-/g, " "));
    } else {
      const iso = tryIsoCodeToken(right);
      if (iso) {
        country = iso;
        city = titleCaseWords(leftRaw.replace(/-/g, " "));
      }
    }
  }

  if (country === "UNKNOWN") {
    for (const key of COUNTRY_NAME_KEYS_SORTED) {
      if (lowerFull.includes(key)) {
        country = COUNTRY_NAME_TO_CODE[key]!;
        break;
      }
    }
  }

  if (country === "UNKNOWN") {
    for (const seg of segments) {
      const iso = tryIsoCodeToken(seg);
      if (iso) {
        country = iso;
        break;
      }
      const k = seg.toLowerCase();
      if (COUNTRY_NAME_TO_CODE[k]) {
        country = COUNTRY_NAME_TO_CODE[k]!;
        break;
      }
      const g = countries.getAlpha2Code(seg, "en");
      if (g && VALID_COUNTRY_CODES.has(g)) {
        country = g;
        break;
      }
    }
  }

  if (country === "UNKNOWN") {
    for (const c of COUNTRY_LIST) {
      const nl = c.name.toLowerCase();
      if (lowerFull.includes(nl) || lowerFull === c.slug) {
        country = c.code;
        break;
      }
    }
  }

  if (country === "UNKNOWN") {
    const g2 = countries.getAlpha2Code(text, "en");
    if (g2 && VALID_COUNTRY_CODES.has(g2)) country = g2;
  }

  if (country === "UNKNOWN" || (country === "US" && !state)) {
    for (const seg of segments) {
      const up = seg.trim().toUpperCase();
      if (up.length !== 2 || !US_STATES[up]) continue;
      const others = segments.filter((s) => s.trim().toUpperCase() !== up);
      if (others.length === 0) continue;
      const joinedKey = others.join(" ").toLowerCase().replace(/-/g, " ");
      const hint =
        CITY_TO_COUNTRY[joinedKey] ??
        (others.length === 1 ? CITY_TO_COUNTRY[others[0]!.toLowerCase().replace(/-/g, " ")] : undefined);
      if (hint && hint === up && VALID_COUNTRY_CODES.has(up)) continue;
      country = "US";
      state = US_STATES[up]!;
      city = titleCaseWords(others.join(" ").replace(/-/g, " "));
      break;
    }
  }

  for (const seg of segments) {
    const up = seg.trim().toUpperCase();
    if (up.length !== 2 || !IN_STATES[up]) continue;
    const others = segments.filter((s) => s.trim().toUpperCase() !== up);
    if (country !== "UNKNOWN" && country !== "IN") continue;
    country = "IN";
    state = IN_STATES[up]!;
    const other = others.find((s) => !tryIsoCodeToken(s));
    if (other) city = titleCaseWords(other.replace(/-/g, " "));
    break;
  }

  for (const seg of segments) {
    const nl = seg.toLowerCase();
    const fullIn = IN_STATE_BY_LOWER.get(nl);
    if (!fullIn) continue;
    if (country !== "UNKNOWN" && country !== "IN") continue;
    country = "IN";
    state = fullIn;
    const others = segments.filter((s) => s.toLowerCase() !== nl);
    const other = others.find((s) => !tryIsoCodeToken(s) && !IN_STATE_BY_LOWER.has(s.toLowerCase()));
    if (other) city = titleCaseWords(other.replace(/-/g, " "));
    break;
  }

  if (!city) {
    for (const seg of segments) {
      const ck = seg.toLowerCase().replace(/-/g, " ");
      if (!CITY_TO_COUNTRY[ck]) continue;
      country = CITY_TO_COUNTRY[ck]!;
      city = titleCaseWords(seg.replace(/-/g, " "));
      break;
    }
  }

  if (city === null && segments.length === 1 && country !== "UNKNOWN") {
    const only = segments[0]!;
    if (!tryIsoCodeToken(only) && !US_STATES[only.toUpperCase()] && !IN_STATES[only.toUpperCase()]) {
      const ck = only.toLowerCase().replace(/-/g, " ");
      if (!COUNTRY_NAME_TO_CODE[ck] && !countries.getAlpha2Code(only, "en")) {
        city = titleCaseWords(only.replace(/-/g, " "));
      }
    }
  }

  if (isRemote && lowerFull.includes("europe") && country === "UNKNOWN") {
    return { city, state, country: "UNKNOWN", region: "Europe", isRemote: true };
  }

  const region = regionForCountry(country);

  return { city, state, country, region, isRemote };
}

/** Synthetic region for jobs with `locationCountry === "GLOBAL"` (worldwide remote). */
export const GLOBAL_REGION_LABEL = "Global";

export function getRegions(): string[] {
  const base = Array.from(new Set(Object.values(REGION_MAP))).sort((a, b) =>
    a.localeCompare(b),
  );
  if (!base.includes(GLOBAL_REGION_LABEL)) {
    base.push(GLOBAL_REGION_LABEL);
    base.sort((a, b) => a.localeCompare(b));
  }
  return base;
}

/** Expand a user filter string to ISO country codes for OR queries. */
export function expandLocationFilter(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const regions = getRegions();
  const rMatch = regions.find((r) => r.toLowerCase() === q);
  if (rMatch) {
    if (rMatch === GLOBAL_REGION_LABEL) return ["GLOBAL"];
    return ALL_ISO_CODES.filter((c) => REGION_MAP[c] === rMatch);
  }

  if (COUNTRY_NAME_TO_CODE[q]) return [COUNTRY_NAME_TO_CODE[q]!];

  const iso = tryIsoCodeToken(q);
  if (iso) return [iso];

  if (CITY_TO_COUNTRY[q]) return [CITY_TO_COUNTRY[q]!];

  for (const c of COUNTRY_LIST) {
    if (c.name.toLowerCase() === q || c.slug === q) return [c.code];
  }

  const g = countries.getAlpha2Code(query, "en");
  if (g && VALID_COUNTRY_CODES.has(g)) return [g];

  const out = new Set<string>();
  for (const [city, code] of Object.entries(CITY_TO_COUNTRY)) {
    if (city.includes(q) || q.includes(city)) out.add(code);
  }
  return Array.from(out);
}

export function testLocationResolver(): void {
  const cases: Array<{
    name: string;
    fn: () => boolean;
  }> = [
    {
      name: "Chennai, IN",
      fn: () => {
        const r = resolveLocation("Chennai, IN");
        return r.country === "IN" && r.region === "Asia" && r.city === "Chennai";
      },
    },
    {
      name: "Itasca, IL",
      fn: () => {
        const r = resolveLocation("Itasca, IL");
        return r.country === "US" && r.region === "North America" && r.city === "Itasca";
      },
    },
    {
      name: "London, UK",
      fn: () => {
        const r = resolveLocation("London, UK");
        return r.country === "GB" && r.region === "Europe";
      },
    },
    {
      name: "Singapore",
      fn: () => {
        const r = resolveLocation("Singapore");
        return r.country === "SG" && r.region === "Asia";
      },
    },
    {
      name: "Remote - Europe",
      fn: () => {
        const r = resolveLocation("Remote - Europe");
        return r.isRemote === true && r.region === "Europe";
      },
    },
    {
      name: "Barcelona (ES)",
      fn: () => {
        const r = resolveLocation("Barcelona (ES)");
        return r.country === "ES" && r.city === "Barcelona" && r.isRemote === false;
      },
    },
    {
      name: "Bangalore",
      fn: () => {
        const r = resolveLocation("Bangalore");
        return r.country === "IN" && r.region === "Asia" && r.city === "Bangalore";
      },
    },
    {
      name: "New York, NY",
      fn: () => {
        const r = resolveLocation("New York, NY");
        return r.country === "US" && r.state === "New York";
      },
    },
    {
      name: "New York City",
      fn: () => {
        const r = resolveLocation("New York City");
        return r.country === "US" && r.city === "New York City";
      },
    },
    {
      name: "Dubai, UAE",
      fn: () => {
        const r = resolveLocation("Dubai, UAE");
        return r.country === "AE" && r.region === "Middle East";
      },
    },
    {
      name: 'expand "Asia" ≥15 codes',
      fn: () => expandLocationFilter("Asia").length >= 15,
    },
    {
      name: 'expand "India" → [IN]',
      fn: () => {
        const a = expandLocationFilter("India");
        return a.length === 1 && a[0] === "IN";
      },
    },
    {
      name: 'expand "chennai" → [IN]',
      fn: () => {
        const a = expandLocationFilter("chennai");
        return a.length === 1 && a[0] === "IN";
      },
    },
  ];

  let failures = 0;
  for (const c of cases) {
    if (!c.fn()) failures++;
  }
  if (failures > 0) {
    console.error(
      `locationResolver self-check: ${failures}/${cases.length} case(s) failed`,
    );
    process.exit(1);
  }
}

const __filename = fileURLToPath(import.meta.url);
const isMain =
  !!process.argv[1] &&
  path.normalize(path.resolve(process.argv[1])) === path.normalize(__filename);
if (isMain) {
  testLocationResolver();
}
