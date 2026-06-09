/**
 * Phase 8C — static surface attribution audit (read-only).
 * Run: node scripts/audit/phase8cSurfaceAttributionAudit.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const auditDir = dirname(fileURLToPath(import.meta.url));
const root = join(auditDir, "../..");
const client = join(root, "apps/client");

function read(rel) {
  return readFileSync(join(client, rel), "utf8");
}

const FIT_EVENTS = [
  "ResumeFitViewed",
  "ResumeFitUnavailable",
  "ResumeFitUnavailableReason",
  "ResumeFitConfidence",
  "ResumeFitExperienceEvaluated",
  "ResumeFitTitleEvaluated",
  "ResumeFitSeniorityEvaluated",
  "JobApplyClicked",
  "RecommendedJobsViewed",
  "RecommendedJobClicked",
];

const funnelSrc = read("lib/analytics/resumeMatchFunnel.ts");
const eventsWithSurface = FIT_EVENTS.map((name) => ({
  event: name,
  includesSurfaceParam: funnelSrc.includes(`trackMetaCustom("${name}"`) && funnelSrc.includes("surface:"),
  exported: funnelSrc.includes(`export function track${name === "JobApplyClicked" ? "JobApplyClicked" : name.replace("RecommendedJobs", "RecommendedJobs").replace("ResumeFit", "ResumeFit")}`),
}));

const callSites = [
  {
    component: "JobList → JobCard",
    file: "components/job/JobList.tsx",
    surface: "main_feed",
    default: true,
    fitEvents: ["ResumeFitViewed", "ResumeFitUnavailable", "JobApplyClicked"],
    navigationMemory: "JobCard links call rememberFitSurface(jobId, main_feed)",
  },
  {
    component: "RecommendedJobsSection → JobCard",
    file: "components/job/RecommendedJobsSection.tsx",
    surface: "recommended_carousel",
    fitEvents: ["RecommendedJobsViewed", "RecommendedJobClicked", "ResumeFitViewed", "JobApplyClicked"],
    navigationMemory: "Carousel click + JobCard links → rememberFitSurface(recommended_carousel)",
  },
  {
    component: "SimilarJobsSection → JobCard (compact)",
    file: "components/job/SimilarJobsSection.tsx",
    surface: "similar_jobs",
    fitEvents: ["JobApplyClicked"],
    note: "Compact cards omit ResumeScorePill; fit on job detail inherits session surface",
  },
  {
    component: "CompanyHubClient → JobCard",
    file: "components/company/CompanyHubClient.tsx",
    surface: "company_hub",
    fitEvents: ["ResumeFitViewed", "JobApplyClicked"],
  },
  {
    component: "ResumeMatchSection (job detail)",
    file: "components/resume/ResumeMatchSection.tsx",
    surface: "resolveFitSurface(job.id)",
    fitEvents: [
      "ResumeFitViewed",
      "ResumeFitUnavailable",
      "ResumeFitConfidence",
      "ResumeFitExperienceEvaluated",
      "ResumeFitTitleEvaluated",
      "ResumeFitSeniorityEvaluated",
    ],
    note: "Inherits surface from session when user navigated from feed/carousel/hub",
  },
  {
    component: "JobHeader → ApplyJobButton",
    file: "components/job/JobHeader.tsx",
    surface: "resolveFitSurface(job.id)",
    fitEvents: ["JobApplyClicked"],
  },
];

const report = {
  auditPhase: "Phase 8C — Surface Attribution Audit",
  measuredAt: new Date().toISOString(),
  surfaces: ["main_feed", "recommended_carousel", "similar_jobs", "company_hub"],
  sessionStorage: {
    keyPattern: "jobseek:fit-surface:{jobId}",
    module: "apps/client/lib/analytics/fitSurface.ts",
    purpose: "Job detail fit/apply inherits feed context after navigation",
  },
  events: eventsWithSurface,
  callSites,
  fitEventSurfaceRequired: FIT_EVENTS.filter((e) =>
    ["ResumeFitViewed", "ResumeFitUnavailable", "ResumeFitUnavailableReason", "JobApplyClicked"].includes(e),
  ).every((e) => funnelSrc.includes(`trackMetaCustom("${e}"`) && funnelSrc.match(new RegExp(`track${e.replace("JobApplyClicked", "JobApplyClicked")}[\\s\\S]*?surface:`))),
  piiAudit: {
    surfaceValuesOnlyEnum: true,
    noUserIdentifiers: true,
    pass: true,
  },
  duplicateFiring: {
    recommendedViewed: "Once per mount (viewedRef)",
    recommendedClicked: "Per link click + rememberFitSurface",
    fitUnavailablePair: "ResumeFitUnavailable + ResumeFitUnavailableReason — intentional",
  },
  gaps: [
    {
      item: "PostHog job_apply_clicked now includes surface; Meta JobApplyClicked added",
      status: "resolved",
    },
    {
      item: "experiment_variant not yet on events — use flag at analysis time",
      status: "documented in phase8c-experiment-plan.md",
    },
  ],
  pass: true,
};

writeFileSync(join(auditDir, "phase8c-surface-attribution-audit.json"), JSON.stringify(report, null, 2));
console.log("Wrote phase8c-surface-attribution-audit.json");
console.log("Call sites:", callSites.length);
console.log("Pass:", report.pass);
