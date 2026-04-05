import { loadRootEnv } from "../src/infrastructure/env/loadEnv.js";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { detectATS, extractLinks, homepageUrlForDomain } from "../src/modules/discovery/detectors/ats.detector.js";
import { fetchCareersHtmlWithMeta } from "../src/utils/fetchCareersHtml.js";
import { asyncPool } from "../src/utils/asyncPool.js";

loadRootEnv();

const CRAWLABLE = new Set(["greenhouse", "lever", "ashby", "workday"]);
const SUPPORTED_PATTERN_TYPES = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "smartrecruiters",
  "jobvite",
  "bamboohr",
  "workday",
]);
const UNSUPPORTED_SIGNATURES: Array<{ type: string; re: RegExp }> = [
  { type: "teamtailor", re: /teamtailor\.com/i },
  { type: "rippling", re: /rippling\.com\/(?:careers|jobs)/i },
  { type: "icims", re: /icims\.com/i },
  { type: "myworkdaysite", re: /myworkdaysite\.com/i },
  { type: "jobsoid", re: /jobsoid\.com/i },
  { type: "recruitee", re: /recruitee\.com/i },
  { type: "personio", re: /personio\.(?:de|com)/i },
  { type: "workforcenow", re: /workforcenow\.adp\.com/i },
  { type: "oracle_hcm", re: /fa\.oraclecloud\.com\/hcmUI\/CandidateExperience/i },
];

type InspectResult = {
  companyId: string;
  domain: string | null;
  careersUrl: string | null;
  detectSupported: string | null;
  unsupportedSignal: string | null;
  classLetter: "A" | "B" | "C";
  evidence: string;
};

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(2)}%`;
}

function firstUnsupportedSignal(blob: string): string | null {
  for (const s of UNSUPPORTED_SIGNATURES) {
    if (s.re.test(blob)) return s.type;
  }
  return null;
}

async function inspectCompany(company: {
  id: string;
  domain: string | null;
  careersUrl: string | null;
}): Promise<InspectResult> {
  const careersUrl = company.careersUrl;
  const domain = company.domain;
  const homeUrl = domain ? homepageUrlForDomain(domain) : null;

  const [home, careers] = await Promise.all([
    homeUrl ? fetchCareersHtmlWithMeta(homeUrl, 10_000) : Promise.resolve({ html: null, fetched: false, error: "no_domain", htmlLength: 0 }),
    careersUrl ? fetchCareersHtmlWithMeta(careersUrl, 10_000) : Promise.resolve({ html: null, fetched: false, error: "no_careers", htmlLength: 0 }),
  ]);

  const chunks = [home.html ?? "", careers.html ?? "", careersUrl ?? "", homeUrl ?? ""];
  const blob = chunks.join("\n");

  let supported: string | null = null;
  if (home.html) {
    const h = detectATS({ html: home.html, links: extractLinks(home.html, homeUrl ?? undefined), baseUrl: homeUrl ?? undefined });
    supported = h.type;
  }
  if (!supported && careers.html) {
    const c = detectATS({ html: careers.html, links: extractLinks(careers.html, careersUrl ?? undefined), baseUrl: careersUrl ?? undefined });
    supported = c.type;
  }

  const unsupported = firstUnsupportedSignal(blob);

  let classLetter: "A" | "B" | "C" = "C";
  let evidence = "no ATS signature in fetched HTML/URLs";
  if (supported && SUPPORTED_PATTERN_TYPES.has(supported)) {
    classLetter = "A";
    evidence = `supported ATS signature found (${supported}) while atsType is null`;
  } else if (unsupported) {
    classLetter = "B";
    evidence = `unsupported ATS signature found (${unsupported})`;
  }

  return {
    companyId: company.id,
    domain,
    careersUrl,
    detectSupported: supported,
    unsupportedSignal: unsupported,
    classLetter,
    evidence,
  };
}

async function main(): Promise<void> {
  const totalCompanies = await prisma.company.count();
  const [nulls, gh, lv, ash, wd] = await Promise.all([
    prisma.company.count({ where: { atsType: null } }),
    prisma.company.count({ where: { atsType: "greenhouse" } }),
    prisma.company.count({ where: { atsType: "lever" } }),
    prisma.company.count({ where: { atsType: "ashby" } }),
    prisma.company.count({ where: { atsType: "workday" } }),
  ]);
  const detected = totalCompanies - nulls;
  const others = Math.max(0, detected - (gh + lv + ash + wd));
  const crawlableDetected = gh + lv + ash + wd;
  const detectedNotCrawlable = Math.max(0, detected - crawlableDetected);

  console.log("\n=== PART 1: ATS coverage in DB ===");
  console.log(JSON.stringify({
    totalCompanies,
    detected,
    atsNull: nulls,
    greenhouse: gh,
    lever: lv,
    ashby: ash,
    workday: wd,
    othersDetected: others,
    pctActuallyCrawlableOfAll: pct(crawlableDetected, totalCompanies),
    pctActuallyCrawlableOfDetected: pct(crawlableDetected, detected),
    pctDetectedNotCrawlableOfDetected: pct(detectedNotCrawlable, detected),
  }, null, 2));

  const sample20 = await prisma.company.findMany({
    where: { atsType: null, careersUrl: { not: null } },
    select: { id: true, domain: true, careersUrl: true },
    take: 20,
    orderBy: { updatedAt: "desc" },
  });

  const inspected = await asyncPool(sample20, 4, (c) => inspectCompany(c));
  const A = inspected.filter((x) => x.classLetter === "A").length;
  const B = inspected.filter((x) => x.classLetter === "B").length;
  const C = inspected.filter((x) => x.classLetter === "C").length;

  console.log("\n=== PART 2: undetected sample classification (n=20) ===");
  console.log(JSON.stringify({ sampleSize: inspected.length, A_supported_but_failed: A, B_unsupported_ats: B, C_no_ats_signal: C, pctA: pct(A, inspected.length), pctB: pct(B, inspected.length), pctC: pct(C, inspected.length) }, null, 2));
  for (const row of inspected) {
    console.log(JSON.stringify(row));
  }

  const wdCandidates = await prisma.company.findMany({
    where: {
      careersUrl: { not: null },
      OR: [
        { careersUrl: { contains: "workday", mode: "insensitive" } },
        { careersUrl: { contains: "myworkdaysite", mode: "insensitive" } },
        { careersUrl: { contains: "myworkdayjobs", mode: "insensitive" } },
      ],
    },
    select: { id: true, careersUrl: true, domain: true, atsType: true },
  });

  const wdCheck = await asyncPool(wdCandidates, 5, async (c) => {
    const careers = await fetchCareersHtmlWithMeta(c.careersUrl!, 10_000);
    const homeUrl = c.domain ? homepageUrlForDomain(c.domain) : null;
    const home = homeUrl ? await fetchCareersHtmlWithMeta(homeUrl, 10_000) : { html: null, fetched: false, error: "no_domain", htmlLength: 0 };
    let detectedType: string | null = null;
    if (careers.html) {
      detectedType = detectATS({ html: careers.html, links: extractLinks(careers.html, c.careersUrl!), baseUrl: c.careersUrl! }).type;
    }
    if (!detectedType && home.html) {
      detectedType = detectATS({ html: home.html, links: extractLinks(home.html, homeUrl ?? undefined), baseUrl: homeUrl ?? undefined }).type;
    }
    return { id: c.id, careersUrl: c.careersUrl!, atsType: c.atsType, detectedType };
  });
  const missedWorkday = wdCheck.filter((x) => x.detectedType !== "workday").length;

  console.log("\n=== PART 3: Workday detection gap ===");
  console.log(JSON.stringify({
    candidateCompanies: wdCheck.length,
    detectedAsWorkday: wdCheck.length - missedWorkday,
    missedByDetectATS: missedWorkday,
    missRate: pct(missedWorkday, wdCheck.length),
  }, null, 2));

  const fetchDomainSample = await prisma.company.findMany({
    where: { domain: { not: null } },
    select: { id: true, domain: true },
    take: 300,
    orderBy: { updatedAt: "desc" },
  });
  const fetchCareersSample = await prisma.company.findMany({
    where: { careersUrl: { not: null } },
    select: { id: true, careersUrl: true },
    take: 300,
    orderBy: { updatedAt: "desc" },
  });

  const homeFetch = await asyncPool(fetchDomainSample, 8, async (c) => {
    const meta = await fetchCareersHtmlWithMeta(homepageUrlForDomain(c.domain!), 10_000);
    return meta.fetched && meta.htmlLength > 0;
  });
  const careersFetch = await asyncPool(fetchCareersSample, 8, async (c) => {
    const meta = await fetchCareersHtmlWithMeta(c.careersUrl!, 10_000);
    return meta.fetched && meta.htmlLength > 0;
  });

  const homeFailures = homeFetch.filter((x) => !x).length;
  const careersFailures = careersFetch.filter((x) => !x).length;

  console.log("\n=== PART 4: fetch reliability (sample-based) ===");
  console.log(JSON.stringify({
    homepageSample: homeFetch.length,
    homepageFetchFailures: homeFailures,
    homepageFailureRate: pct(homeFailures, homeFetch.length),
    careersSample: careersFetch.length,
    careersFetchFailures: careersFailures,
    careersFailureRate: pct(careersFailures, careersFetch.length),
  }, null, 2));

  // Ceiling estimate (using detected + undetected sample classification)
  const undetected = nulls;
  const estUndetectedA = (A / Math.max(1, inspected.length)) * undetected;
  const estUndetectedB = (B / Math.max(1, inspected.length)) * undetected;
  const estUndetectedC = (C / Math.max(1, inspected.length)) * undetected;

  const estAtsBacked = detected + estUndetectedA + estUndetectedB;
  const estDetectableNow = detected + estUndetectedA; // A is signal present but not detected
  const estNotDetectableNow = estUndetectedB + estUndetectedC;

  console.log("\n=== PART 5: realistic ceiling estimate ===");
  console.log(JSON.stringify({
    note: "Undetected split is extrapolated from sample n=20 (atsType null + careersUrl exists)",
    estPctActuallyAtsBacked: pct(Math.round(estAtsBacked), totalCompanies),
    estPctDetectableWithCurrentSystem: pct(Math.round(estDetectableNow), totalCompanies),
    estPctFundamentallyNotDetectableNow: pct(Math.round(estNotDetectableNow), totalCompanies),
    lossBreakdown: {
      bugsOrDetectionMisses_A: pct(Math.round(estUndetectedA), totalCompanies),
      missingCoverage_B: pct(Math.round(estUndetectedB), totalCompanies),
      customOrNoSignal_C: pct(Math.round(estUndetectedC), totalCompanies),
      fetchIssueObservedSample_D: pct(careersFailures, careersFetch.length),
    },
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
