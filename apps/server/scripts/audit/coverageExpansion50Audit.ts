/**
 * Phases 2–6: discover, dedupe, validate, rank 50 NEW ATS endpoints (read-only).
 * Run: npx tsx scripts/audit/coverageExpansion50Audit.ts
 */
import { writeFileSync } from "node:fs";
import { loadRootEnv } from "../../src/infrastructure/env/loadEnv.js";
import { prisma } from "../../src/infrastructure/db/prisma.js";
import type { AtsType } from "../../src/modules/ats/ats.interface.js";
import { parseCrawlableBoard } from "../../src/modules/atsDiscovery/atsUrlParser.js";
import { probeBoardLive } from "../rollout/boardProbe.js";
import { fetchCareersHtmlWithMeta } from "../../src/utils/fetchCareersHtml.js";
import { detectAtsTypeFromUrl } from "../../src/modules/atsDiscovery/atsUrlParser.js";
import { extractAshbyToken } from "../../src/modules/discovery/extractors/ashby.extractor.js";
import { extractGreenhouseToken } from "../../src/modules/discovery/extractors/greenhouse.extractor.js";
import { extractLeverToken } from "../../src/modules/discovery/extractors/lever.extractor.js";
import { extractWorkdayToken } from "../../src/modules/discovery/extractors/workday.extractor.js";

loadRootEnv();

type CandidateInput = {
  name: string;
  domain: string;
  careersUrl: string;
  category: string;
  /** If known from research */
  atsType?: AtsType;
  atsToken?: string;
};

type ValidationResult = {
  company: string;
  domain: string;
  careersUrl: string;
  category: string;
  atsType: string;
  atsToken: string;
  endpointUrl: string;
  slug: string;
  jobCount: number;
  engineeringJobs: number;
  remoteJobs: number;
  validationResult: "ok" | "empty" | "not_found" | "error" | "unparseable" | "rejected_existing";
  rejectionReason?: string;
  score: number;
  reasonSelected: string;
};

const ENGINEERING_RE =
  /\b(engineer|engineering|developer|software|backend|frontend|full[\s-]?stack|platform|infrastructure|devops|sre|ml|machine learning|data scien|data engineer)\b/i;
const PRODUCT_RE = /\b(product manager|product design|designer|ux|ui)\b/i;
const DATA_RE = /\b(data scien|data engineer|analytics|ml engineer)\b/i;

// 200 curated candidates from YC batches, Series A/B, remote-first, SaaS, AI, fintech, devtools, cloud, enterprise, cybersecurity
const CANDIDATES: CandidateInput[] = [
  // YC W25/S25/F25/W26 recent
  { name: "Nango", domain: "nango.dev", careersUrl: "https://jobs.ashbyhq.com/nango", category: "devtools", atsType: "ashby", atsToken: "nango" },
  { name: "Juicebox", domain: "juicebox.work", careersUrl: "https://jobs.ashbyhq.com/juicebox", category: "ai", atsType: "ashby", atsToken: "juicebox" },
  { name: "Proliferate", domain: "proliferate.com", careersUrl: "https://jobs.ashbyhq.com/proliferate", category: "ai", atsType: "ashby", atsToken: "proliferate" },
  { name: "Pelica", domain: "pelica.ai", careersUrl: "https://jobs.ashbyhq.com/pelica", category: "ai", atsType: "ashby", atsToken: "pelica" },
  { name: "Kaizen Automation", domain: "kaizenautomation.com", careersUrl: "https://jobs.ashbyhq.com/kaizen", category: "ai", atsType: "ashby", atsToken: "kaizen" },
  { name: "Converge", domain: "runconverge.com", careersUrl: "https://jobs.ashbyhq.com/converge", category: "devtools", atsType: "ashby", atsToken: "converge" },
  { name: "9 Mothers", domain: "9mothers.com", careersUrl: "https://jobs.ashbyhq.com/9mothers", category: "defense", atsType: "ashby", atsToken: "9mothers" },
  { name: "Terranox AI", domain: "terranox.ai", careersUrl: "https://jobs.ashbyhq.com/terranox", category: "ai", atsType: "ashby", atsToken: "terranox" },
  { name: "Bild AI", domain: "bild.ai", careersUrl: "https://jobs.ashbyhq.com/bild", category: "ai", atsType: "ashby", atsToken: "bild" },
  { name: "AnswerThis", domain: "answerthis.io", careersUrl: "https://jobs.ashbyhq.com/answerthis", category: "ai", atsType: "ashby", atsToken: "answerthis" },
  { name: "Structured AI", domain: "structured.ai", careersUrl: "https://jobs.ashbyhq.com/structured", category: "ai", atsType: "ashby", atsToken: "structured" },
  { name: "Multifactor", domain: "multifactor.com", careersUrl: "https://jobs.ashbyhq.com/multifactor", category: "cybersecurity", atsType: "ashby", atsToken: "multifactor" },
  { name: "SIM", domain: "sim.ai", careersUrl: "https://jobs.ashbyhq.com/sim", category: "ai", atsType: "ashby", atsToken: "sim" },
  { name: "Ndea", domain: "ndea.com", careersUrl: "https://jobs.ashbyhq.com/ndea", category: "ai", atsType: "ashby", atsToken: "ndea" },
  { name: "Mbodi AI", domain: "mbodi.ai", careersUrl: "https://jobs.ashbyhq.com/mbodi", category: "ai", atsType: "ashby", atsToken: "mbodi" },
  { name: "RentFlow", domain: "rentflow.com", careersUrl: "https://jobs.ashbyhq.com/rentflow", category: "fintech", atsType: "ashby", atsToken: "rentflow" },
  { name: "Mintlify", domain: "mintlify.com", careersUrl: "https://jobs.ashbyhq.com/mintlify", category: "devtools", atsType: "ashby", atsToken: "mintlify" },
  { name: "Browserbase", domain: "browserbase.com", careersUrl: "https://jobs.ashbyhq.com/browserbase", category: "devtools", atsType: "ashby", atsToken: "browserbase" },
  { name: "Exa", domain: "exa.ai", careersUrl: "https://jobs.ashbyhq.com/exa", category: "ai", atsType: "ashby", atsToken: "exa" },
  { name: "Reducto", domain: "reducto.ai", careersUrl: "https://jobs.ashbyhq.com/reducto", category: "ai", atsType: "ashby", atsToken: "reducto" },
  { name: "Vapi", domain: "vapi.ai", careersUrl: "https://jobs.ashbyhq.com/vapi", category: "ai", atsType: "ashby", atsToken: "vapi" },
  { name: "11x", domain: "11x.ai", careersUrl: "https://jobs.ashbyhq.com/11x", category: "ai", atsType: "ashby", atsToken: "11x" },
  { name: "Delve", domain: "delve.co", careersUrl: "https://jobs.ashbyhq.com/delve", category: "cybersecurity", atsType: "ashby", atsToken: "delve" },
  { name: "Rox", domain: "rox.com", careersUrl: "https://jobs.ashbyhq.com/rox", category: "saas", atsType: "ashby", atsToken: "rox" },
  { name: "Wordware", domain: "wordware.ai", careersUrl: "https://jobs.ashbyhq.com/wordware", category: "ai", atsType: "ashby", atsToken: "wordware" },
  { name: "Pylon", domain: "usepylon.com", careersUrl: "https://jobs.ashbyhq.com/pylon", category: "saas", atsType: "ashby", atsToken: "pylon" },
  { name: "Greptile", domain: "greptile.com", careersUrl: "https://jobs.ashbyhq.com/greptile", category: "devtools", atsType: "ashby", atsToken: "greptile" },
  { name: "Cognition", domain: "cognition.ai", careersUrl: "https://jobs.ashbyhq.com/cognition", category: "ai", atsType: "ashby", atsToken: "cognition" },
  { name: "Sierra", domain: "sierra.ai", careersUrl: "https://jobs.ashbyhq.com/sierra", category: "ai", atsType: "ashby", atsToken: "sierra" },
  { name: "Hebbia", domain: "hebbia.ai", careersUrl: "https://jobs.ashbyhq.com/hebbia", category: "ai", atsType: "ashby", atsToken: "hebbia" },
  // Greenhouse startups
  { name: "Harvey", domain: "harvey.ai", careersUrl: "https://boards.greenhouse.io/harvey", category: "ai", atsType: "greenhouse", atsToken: "harvey" },
  { name: "Glean", domain: "glean.com", careersUrl: "https://boards.greenhouse.io/glean", category: "ai", atsType: "greenhouse", atsToken: "glean" },
  { name: "Perplexity", domain: "perplexity.ai", careersUrl: "https://boards.greenhouse.io/perplexityai", category: "ai", atsType: "greenhouse", atsToken: "perplexityai" },
  { name: "Cohere", domain: "cohere.com", careersUrl: "https://boards.greenhouse.io/cohere", category: "ai", atsType: "greenhouse", atsToken: "cohere" },
  { name: "Mistral AI", domain: "mistral.ai", careersUrl: "https://boards.greenhouse.io/mistral", category: "ai", atsType: "greenhouse", atsToken: "mistral" },
  { name: "Together AI", domain: "together.ai", careersUrl: "https://boards.greenhouse.io/togetherai", category: "ai", atsType: "greenhouse", atsToken: "togetherai" },
  { name: "Weights & Biases", domain: "wandb.ai", careersUrl: "https://boards.greenhouse.io/wandb", category: "devtools", atsType: "greenhouse", atsToken: "wandb" },
  { name: "LangChain", domain: "langchain.com", careersUrl: "https://boards.greenhouse.io/langchain", category: "devtools", atsType: "greenhouse", atsToken: "langchain" },
  { name: "Pinecone", domain: "pinecone.io", careersUrl: "https://boards.greenhouse.io/pinecone", category: "ai", atsType: "greenhouse", atsToken: "pinecone" },
  { name: "Hugging Face", domain: "huggingface.co", careersUrl: "https://boards.greenhouse.io/huggingface", category: "ai", atsType: "greenhouse", atsToken: "huggingface" },
  { name: "Replicate", domain: "replicate.com", careersUrl: "https://boards.greenhouse.io/replicate", category: "ai", atsType: "greenhouse", atsToken: "replicate" },
  { name: "Runway", domain: "runwayml.com", careersUrl: "https://boards.greenhouse.io/runwayml", category: "ai", atsType: "greenhouse", atsToken: "runwayml" },
  { name: "Abridge", domain: "abridge.com", careersUrl: "https://boards.greenhouse.io/abridge", category: "ai", atsType: "greenhouse", atsToken: "abridge" },
  { name: "Suno", domain: "suno.com", careersUrl: "https://boards.greenhouse.io/suno", category: "ai", atsType: "greenhouse", atsToken: "suno" },
  { name: "ElevenLabs", domain: "elevenlabs.io", careersUrl: "https://boards.greenhouse.io/elevenlabs", category: "ai", atsType: "greenhouse", atsToken: "elevenlabs" },
  { name: "Snorkel AI", domain: "snorkel.ai", careersUrl: "https://boards.greenhouse.io/snorkel", category: "ai", atsType: "greenhouse", atsToken: "snorkel" },
  { name: "Adept", domain: "adept.ai", careersUrl: "https://boards.greenhouse.io/adept", category: "ai", atsType: "greenhouse", atsToken: "adept" },
  { name: "Character.AI", domain: "character.ai", careersUrl: "https://boards.greenhouse.io/character", category: "ai", atsType: "greenhouse", atsToken: "character" },
  { name: "Inflection AI", domain: "inflection.ai", careersUrl: "https://boards.greenhouse.io/inflectionai", category: "ai", atsType: "greenhouse", atsToken: "inflectionai" },
  { name: "Adept AI", domain: "adept.ai", careersUrl: "https://boards.greenhouse.io/adeptai", category: "ai", atsType: "greenhouse", atsToken: "adeptai" },
  // Lever startups
  { name: "Fivetran", domain: "fivetran.com", careersUrl: "https://jobs.lever.co/fivetran", category: "cloud", atsType: "lever", atsToken: "fivetran" },
  { name: "dbt Labs", domain: "getdbt.com", careersUrl: "https://jobs.lever.co/dbtlabsinc", category: "devtools", atsType: "lever", atsToken: "dbtlabsinc" },
  { name: "PostHog", domain: "posthog.com", careersUrl: "https://jobs.lever.co/posthog", category: "devtools", atsType: "lever", atsToken: "posthog" },
  { name: "Tailscale", domain: "tailscale.com", careersUrl: "https://jobs.lever.co/tailscale", category: "cloud", atsType: "lever", atsToken: "tailscale" },
  { name: "Render", domain: "render.com", careersUrl: "https://jobs.lever.co/render", category: "cloud", atsType: "lever", atsToken: "render" },
  { name: "Netlify", domain: "netlify.com", careersUrl: "https://jobs.lever.co/netlify", category: "cloud", atsType: "lever", atsToken: "netlify" },
  { name: "Fly.io", domain: "fly.io", careersUrl: "https://jobs.lever.co/fly", category: "cloud", atsType: "lever", atsToken: "fly" },
  { name: "Temporal", domain: "temporal.io", careersUrl: "https://jobs.lever.co/temporal", category: "devtools", atsType: "lever", atsToken: "temporal" },
  { name: "Cockroach Labs", domain: "cockroachlabs.com", careersUrl: "https://jobs.lever.co/cockroachlabs", category: "cloud", atsType: "lever", atsToken: "cockroachlabs" },
  { name: "Materialize", domain: "materialize.com", careersUrl: "https://jobs.lever.co/materialize", category: "devtools", atsType: "lever", atsToken: "materialize" },
  { name: "Hex", domain: "hex.tech", careersUrl: "https://jobs.lever.co/hex", category: "devtools", atsType: "lever", atsToken: "hex" },
  { name: "Hightouch", domain: "hightouch.com", careersUrl: "https://jobs.lever.co/hightouch", category: "saas", atsType: "lever", atsToken: "hightouch" },
  { name: "Census", domain: "getcensus.com", careersUrl: "https://jobs.lever.co/census", category: "saas", atsType: "lever", atsToken: "census" },
  { name: "Airbyte", domain: "airbyte.com", careersUrl: "https://jobs.lever.co/airbyte", category: "devtools", atsType: "lever", atsToken: "airbyte" },
  { name: "Prefect", domain: "prefect.io", careersUrl: "https://jobs.lever.co/prefect", category: "devtools", atsType: "lever", atsToken: "prefect" },
  { name: "Dagster", domain: "dagster.io", careersUrl: "https://jobs.lever.co/dagster", category: "devtools", atsType: "lever", atsToken: "dagster" },
  { name: "Stytch", domain: "stytch.com", careersUrl: "https://jobs.lever.co/stytch", category: "cybersecurity", atsType: "lever", atsToken: "stytch" },
  { name: "Clerk", domain: "clerk.com", careersUrl: "https://jobs.lever.co/clerk", category: "devtools", atsType: "lever", atsToken: "clerk" },
  { name: "WorkOS", domain: "workos.com", careersUrl: "https://jobs.lever.co/workos", category: "devtools", atsType: "lever", atsToken: "workos" },
  { name: "Svix", domain: "svix.com", careersUrl: "https://jobs.lever.co/svix", category: "devtools", atsType: "lever", atsToken: "svix" },
  // Fintech
  { name: "Brex", domain: "brex.com", careersUrl: "https://boards.greenhouse.io/brex", category: "fintech", atsType: "greenhouse", atsToken: "brex" },
  { name: "Ramp", domain: "ramp.com", careersUrl: "https://jobs.ashbyhq.com/ramp", category: "fintech", atsType: "ashby", atsToken: "ramp" },
  { name: "Mercury", domain: "mercury.com", careersUrl: "https://jobs.lever.co/mercury", category: "fintech", atsType: "lever", atsToken: "mercury" },
  { name: "Arc", domain: "arc.tech", careersUrl: "https://jobs.ashbyhq.com/arc", category: "fintech", atsType: "ashby", atsToken: "arc" },
  { name: "Column", domain: "column.com", careersUrl: "https://boards.greenhouse.io/column", category: "fintech", atsType: "greenhouse", atsToken: "column" },
  { name: "Modern Treasury", domain: "moderntreasury.com", careersUrl: "https://boards.greenhouse.io/moderntreasury", category: "fintech", atsType: "greenhouse", atsToken: "moderntreasury" },
  { name: "Increase", domain: "increase.com", careersUrl: "https://jobs.ashbyhq.com/increase", category: "fintech", atsType: "ashby", atsToken: "increase" },
  { name: "Alloy", domain: "alloy.com", careersUrl: "https://boards.greenhouse.io/alloy", category: "fintech", atsType: "greenhouse", atsToken: "alloy" },
  { name: "Unit", domain: "unit.co", careersUrl: "https://jobs.ashbyhq.com/unit", category: "fintech", atsType: "ashby", atsToken: "unit" },
  { name: "Synctera", domain: "synctera.com", careersUrl: "https://boards.greenhouse.io/synctera", category: "fintech", atsType: "greenhouse", atsToken: "synctera" },
  // Cybersecurity
  { name: "Vanta", domain: "vanta.com", careersUrl: "https://jobs.ashbyhq.com/vanta", category: "cybersecurity", atsType: "ashby", atsToken: "vanta" },
  { name: "Drata", domain: "drata.com", careersUrl: "https://boards.greenhouse.io/drata", category: "cybersecurity", atsType: "greenhouse", atsToken: "drata" },
  { name: "Snyk", domain: "snyk.io", careersUrl: "https://boards.greenhouse.io/snyk", category: "cybersecurity", atsType: "greenhouse", atsToken: "snyk" },
  { name: "Wiz", domain: "wiz.io", careersUrl: "https://boards.greenhouse.io/wiz", category: "cybersecurity", atsType: "greenhouse", atsToken: "wiz" },
  { name: "Lacework", domain: "lacework.com", careersUrl: "https://boards.greenhouse.io/lacework", category: "cybersecurity", atsType: "greenhouse", atsToken: "lacework" },
  { name: "Orca Security", domain: "orca.security", careersUrl: "https://boards.greenhouse.io/orcasecurity", category: "cybersecurity", atsType: "greenhouse", atsToken: "orcasecurity" },
  { name: "Semgrep", domain: "semgrep.dev", careersUrl: "https://jobs.lever.co/semgrep", category: "cybersecurity", atsType: "lever", atsToken: "semgrep" },
  { name: "Chainguard", domain: "chainguard.dev", careersUrl: "https://boards.greenhouse.io/chainguard", category: "cybersecurity", atsType: "greenhouse", atsToken: "chainguard" },
  { name: "1Password", domain: "1password.com", careersUrl: "https://jobs.ashbyhq.com/1password", category: "cybersecurity", atsType: "ashby", atsToken: "1password" },
  { name: "Tailscale Security", domain: "tailscale.com", careersUrl: "https://jobs.lever.co/tailscale", category: "cybersecurity", atsType: "lever", atsToken: "tailscale" },
  // DevTools / Cloud
  { name: "Neon", domain: "neon.tech", careersUrl: "https://jobs.ashbyhq.com/neon", category: "cloud", atsType: "ashby", atsToken: "neon" },
  { name: "PlanetScale", domain: "planetscale.com", careersUrl: "https://boards.greenhouse.io/planetscale", category: "cloud", atsType: "greenhouse", atsToken: "planetscale" },
  { name: "Turso", domain: "turso.tech", careersUrl: "https://jobs.ashbyhq.com/turso", category: "cloud", atsType: "ashby", atsToken: "turso" },
  { name: "Convex", domain: "convex.dev", careersUrl: "https://jobs.ashbyhq.com/convex", category: "devtools", atsType: "ashby", atsToken: "convex" },
  { name: "Railway", domain: "railway.app", careersUrl: "https://jobs.ashbyhq.com/railway", category: "cloud", atsType: "ashby", atsToken: "railway" },
  { name: "Modal", domain: "modal.com", careersUrl: "https://jobs.ashbyhq.com/modal", category: "cloud", atsType: "ashby", atsToken: "modal" },
  { name: "Replit", domain: "replit.com", careersUrl: "https://jobs.ashbyhq.com/replit", category: "devtools", atsType: "ashby", atsToken: "replit" },
  { name: "Sourcegraph", domain: "sourcegraph.com", careersUrl: "https://boards.greenhouse.io/sourcegraph", category: "devtools", atsType: "greenhouse", atsToken: "sourcegraph" },
  { name: "Gitpod", domain: "gitpod.io", careersUrl: "https://boards.greenhouse.io/gitpod", category: "devtools", atsType: "greenhouse", atsToken: "gitpod" },
  { name: "Coder", domain: "coder.com", careersUrl: "https://boards.greenhouse.io/coder", category: "devtools", atsType: "greenhouse", atsToken: "coder" },
  { name: "Turborepo", domain: "vercel.com", careersUrl: "https://boards.greenhouse.io/vercel", category: "devtools", atsType: "greenhouse", atsToken: "vercel" },
  { name: "Prisma", domain: "prisma.io", careersUrl: "https://boards.greenhouse.io/prisma", category: "devtools", atsType: "greenhouse", atsToken: "prisma" },
  { name: "Hasura", domain: "hasura.io", careersUrl: "https://boards.greenhouse.io/hasura", category: "devtools", atsType: "greenhouse", atsToken: "hasura" },
  { name: "Grafana Labs", domain: "grafana.com", careersUrl: "https://boards.greenhouse.io/grafana", category: "devtools", atsType: "greenhouse", atsToken: "grafana" },
  { name: "Chronosphere", domain: "chronosphere.io", careersUrl: "https://boards.greenhouse.io/chronosphere", category: "devtools", atsType: "greenhouse", atsToken: "chronosphere" },
  // Enterprise SaaS
  { name: "Gong", domain: "gong.io", careersUrl: "https://boards.greenhouse.io/gong", category: "enterprise", atsType: "greenhouse", atsToken: "gong" },
  { name: "Clari", domain: "clari.com", careersUrl: "https://boards.greenhouse.io/clari", category: "enterprise", atsType: "greenhouse", atsToken: "clari" },
  { name: "Ironclad", domain: "ironcladapp.com", careersUrl: "https://boards.greenhouse.io/ironclad", category: "enterprise", atsType: "greenhouse", atsToken: "ironclad" },
  { name: "Loom", domain: "loom.com", careersUrl: "https://boards.greenhouse.io/loom", category: "saas", atsType: "greenhouse", atsToken: "loom" },
  { name: "Miro", domain: "miro.com", careersUrl: "https://boards.greenhouse.io/miro", category: "saas", atsType: "greenhouse", atsToken: "miro" },
  { name: "Airtable", domain: "airtable.com", careersUrl: "https://boards.greenhouse.io/airtable", category: "saas", atsType: "greenhouse", atsToken: "airtable" },
  { name: "Webflow", domain: "webflow.com", careersUrl: "https://boards.greenhouse.io/webflow", category: "saas", atsType: "greenhouse", atsToken: "webflow" },
  { name: "Zapier", domain: "zapier.com", careersUrl: "https://boards.greenhouse.io/zapier", category: "saas", atsType: "greenhouse", atsToken: "zapier" },
  { name: "Calendly", domain: "calendly.com", careersUrl: "https://boards.greenhouse.io/calendly", category: "saas", atsType: "greenhouse", atsToken: "calendly" },
  { name: "Notion", domain: "notion.so", careersUrl: "https://boards.greenhouse.io/notion", category: "saas", atsType: "greenhouse", atsToken: "notion" },
  // Workday enterprise
  { name: "ServiceNow", domain: "servicenow.com", careersUrl: "https://servicenow.wd1.myworkdayjobs.com/servicenow", category: "enterprise", atsType: "workday", atsToken: "servicenow.wd1.myworkdayjobs.com__servicenow__careers" },
  { name: "Snowflake", domain: "snowflake.com", careersUrl: "https://snowflake.wd5.myworkdayjobs.com/snowflake", category: "cloud", atsType: "workday", atsToken: "snowflake.wd5.myworkdayjobs.com__snowflake__careers" },
  { name: "Databricks", domain: "databricks.com", careersUrl: "https://databricks.wd5.myworkdayjobs.com/databricks", category: "cloud", atsType: "workday", atsToken: "databricks.wd5.myworkdayjobs.com__databricks__careers" },
  { name: "Palantir", domain: "palantir.com", careersUrl: "https://palantir.wd1.myworkdayjobs.com/palantir", category: "enterprise", atsType: "workday", atsToken: "palantir.wd1.myworkdayjobs.com__palantir__careers" },
  { name: "CrowdStrike", domain: "crowdstrike.com", careersUrl: "https://crowdstrike.wd5.myworkdayjobs.com/crowdstrike", category: "cybersecurity", atsType: "workday", atsToken: "crowdstrike.wd5.myworkdayjobs.com__crowdstrike__careers" },
  // SmartRecruiters
  { name: "Visa", domain: "visa.com", careersUrl: "https://jobs.smartrecruiters.com/Visa", category: "fintech", atsType: "smartrecruiters", atsToken: "Visa" },
  { name: "Santander", domain: "santander.com", careersUrl: "https://jobs.smartrecruiters.com/Santander", category: "fintech", atsType: "smartrecruiters", atsToken: "Santander" },
  { name: "Siemens", domain: "siemens.com", careersUrl: "https://jobs.smartrecruiters.com/Siemens", category: "enterprise", atsType: "smartrecruiters", atsToken: "Siemens" },
  { name: "McDonald's", domain: "mcdonalds.com", careersUrl: "https://jobs.smartrecruiters.com/McDonalds", category: "enterprise", atsType: "smartrecruiters", atsToken: "McDonalds" },
  { name: "Skechers", domain: "skechers.com", careersUrl: "https://jobs.smartrecruiters.com/Skechers", category: "enterprise", atsType: "smartrecruiters", atsToken: "Skechers" },
  // Workable
  { name: "Hotjar", domain: "hotjar.com", careersUrl: "https://apply.workable.com/hotjar/", category: "saas", atsType: "workable", atsToken: "hotjar" },
  { name: "Doist", domain: "doist.com", careersUrl: "https://apply.workable.com/doist/", category: "remote", atsType: "workable", atsToken: "doist" },
  { name: "Prezi", domain: "prezi.com", careersUrl: "https://apply.workable.com/prezi/", category: "saas", atsType: "workable", atsToken: "prezi" },
  { name: "Toggl", domain: "toggl.com", careersUrl: "https://apply.workable.com/toggl/", category: "remote", atsType: "workable", atsToken: "toggl" },
  { name: "Zencargo", domain: "zencargo.com", careersUrl: "https://apply.workable.com/zencargo/", category: "saas", atsType: "workable", atsToken: "zencargo" },
  // BambooHR
  { name: "Buffer", domain: "buffer.com", careersUrl: "https://buffer.bamboohr.com/careers", category: "remote", atsType: "bamboohr", atsToken: "buffer" },
  { name: "Close", domain: "close.com", careersUrl: "https://close.bamboohr.com/careers", category: "saas", atsType: "bamboohr", atsToken: "close" },
  { name: "ConvertKit", domain: "convertkit.com", careersUrl: "https://convertkit.bamboohr.com/careers", category: "saas", atsType: "bamboohr", atsToken: "convertkit" },
  { name: "Ghost", domain: "ghost.org", careersUrl: "https://ghost.bamboohr.com/careers", category: "saas", atsType: "bamboohr", atsToken: "ghost" },
  { name: "Help Scout", domain: "helpscout.com", careersUrl: "https://helpscout.bamboohr.com/careers", category: "saas", atsType: "bamboohr", atsToken: "helpscout" },
  // Teamtailor
  { name: "Klaviyo", domain: "klaviyo.com", careersUrl: "https://careers.klaviyo.com", category: "saas", atsType: "teamtailor", atsToken: "klaviyo" },
  { name: "Spotify", domain: "spotify.com", careersUrl: "https://www.spotifyjobs.com", category: "enterprise", atsType: "teamtailor", atsToken: "spotify" },
  // More YC / AI recent
  { name: "Firecrawl", domain: "firecrawl.dev", careersUrl: "https://jobs.ashbyhq.com/firecrawl", category: "devtools", atsType: "ashby", atsToken: "firecrawl" },
  { name: "ParadeDB", domain: "paradedb.com", careersUrl: "https://jobs.ashbyhq.com/paradedb", category: "cloud", atsType: "ashby", atsToken: "paradedb" },
  { name: "Unstructured", domain: "unstructured.io", careersUrl: "https://jobs.ashbyhq.com/unstructured", category: "ai", atsType: "ashby", atsToken: "unstructured" },
  { name: "LanceDB", domain: "lancedb.com", careersUrl: "https://jobs.ashbyhq.com/lancedb", category: "ai", atsType: "ashby", atsToken: "lancedb" },
  { name: "Chroma", domain: "trychroma.com", careersUrl: "https://jobs.ashbyhq.com/chroma", category: "ai", atsType: "ashby", atsToken: "chroma" },
  { name: "Baseten", domain: "baseten.co", careersUrl: "https://jobs.ashbyhq.com/baseten", category: "ai", atsType: "ashby", atsToken: "baseten" },
  { name: "Anyscale", domain: "anyscale.com", careersUrl: "https://boards.greenhouse.io/anyscale", category: "ai", atsType: "greenhouse", atsToken: "anyscale" },
  { name: "Roboflow", domain: "roboflow.com", careersUrl: "https://boards.greenhouse.io/roboflow", category: "ai", atsType: "greenhouse", atsToken: "roboflow" },
  { name: "Labelbox", domain: "labelbox.com", careersUrl: "https://boards.greenhouse.io/labelbox", category: "ai", atsType: "greenhouse", atsToken: "labelbox" },
  { name: "Scale AI", domain: "scale.com", careersUrl: "https://boards.greenhouse.io/scaleai", category: "ai", atsType: "greenhouse", atsToken: "scaleai" },
  { name: "Surge AI", domain: "surgehq.ai", careersUrl: "https://jobs.ashbyhq.com/surge", category: "ai", atsType: "ashby", atsToken: "surge" },
  { name: "Mercor", domain: "mercor.com", careersUrl: "https://jobs.ashbyhq.com/mercor", category: "ai", atsType: "ashby", atsToken: "mercor" },
  { name: "OpenPipe", domain: "openpipe.ai", careersUrl: "https://jobs.ashbyhq.com/openpipe", category: "ai", atsType: "ashby", atsToken: "openpipe" },
  { name: "Humanloop", domain: "humanloop.com", careersUrl: "https://jobs.ashbyhq.com/humanloop", category: "ai", atsType: "ashby", atsToken: "humanloop" },
  { name: "Braintrust", domain: "usebraintrust.com", careersUrl: "https://jobs.ashbyhq.com/braintrust", category: "ai", atsType: "ashby", atsToken: "braintrust" },
  { name: "Dust", domain: "dust.tt", careersUrl: "https://jobs.ashbyhq.com/dust", category: "ai", atsType: "ashby", atsToken: "dust" },
  { name: "Photoroom", domain: "photoroom.com", careersUrl: "https://jobs.ashbyhq.com/photoroom", category: "ai", atsType: "ashby", atsToken: "photoroom" },
  { name: "Descript", domain: "descript.com", careersUrl: "https://jobs.ashbyhq.com/descript", category: "ai", atsType: "ashby", atsToken: "descript" },
  { name: "Tome", domain: "tome.app", careersUrl: "https://jobs.ashbyhq.com/tome", category: "ai", atsType: "ashby", atsToken: "tome" },
  { name: "Gamma", domain: "gamma.app", careersUrl: "https://jobs.ashbyhq.com/gamma", category: "ai", atsType: "ashby", atsToken: "gamma" },
  // Remote-first
  { name: "GitLab", domain: "gitlab.com", careersUrl: "https://boards.greenhouse.io/gitlab", category: "remote", atsType: "greenhouse", atsToken: "gitlab" },
  { name: "Automattic", domain: "automattic.com", careersUrl: "https://boards.greenhouse.io/automattic", category: "remote", atsType: "greenhouse", atsToken: "automattic" },
  { name: "Zapier Remote", domain: "zapier.com", careersUrl: "https://boards.greenhouse.io/zapier", category: "remote", atsType: "greenhouse", atsToken: "zapier" },
  { name: "Docebo", domain: "docebo.com", careersUrl: "https://boards.greenhouse.io/docebo", category: "saas", atsType: "greenhouse", atsToken: "docebo" },
  { name: "Deel", domain: "deel.com", careersUrl: "https://jobs.ashbyhq.com/deel", category: "remote", atsType: "ashby", atsToken: "deel" },
  { name: "Remote.com", domain: "remote.com", careersUrl: "https://jobs.ashbyhq.com/remote", category: "remote", atsType: "ashby", atsToken: "remote" },
  { name: "Oyster", domain: "oysterhr.com", careersUrl: "https://jobs.ashbyhq.com/oyster", category: "remote", atsType: "ashby", atsToken: "oyster" },
  { name: "Papaya Global", domain: "papayaglobal.com", careersUrl: "https://boards.greenhouse.io/papayaglobal", category: "remote", atsType: "greenhouse", atsToken: "papayaglobal" },
  // Additional Ashby YC
  { name: "Legora", domain: "legora.com", careersUrl: "https://jobs.ashbyhq.com/legora", category: "ai", atsType: "ashby", atsToken: "legora" },
  { name: "HappyRobot", domain: "happyrobot.ai", careersUrl: "https://jobs.ashbyhq.com/happyrobot", category: "ai", atsType: "ashby", atsToken: "happyrobot" },
  { name: "OpenArt", domain: "openart.ai", careersUrl: "https://jobs.ashbyhq.com/openart", category: "ai", atsType: "ashby", atsToken: "openart" },
  { name: "Fal", domain: "fal.ai", careersUrl: "https://jobs.ashbyhq.com/fal", category: "ai", atsType: "ashby", atsToken: "fal" },
  { name: "Cartesia", domain: "cartesia.ai", careersUrl: "https://jobs.ashbyhq.com/cartesia", category: "ai", atsType: "ashby", atsToken: "cartesia" },
  { name: "Hume AI", domain: "hume.ai", careersUrl: "https://jobs.ashbyhq.com/hume", category: "ai", atsType: "ashby", atsToken: "hume" },
  { name: "Sesame", domain: "sesame.com", careersUrl: "https://jobs.ashbyhq.com/sesame", category: "ai", atsType: "ashby", atsToken: "sesame" },
  { name: "Luma AI", domain: "lumalabs.ai", careersUrl: "https://jobs.ashbyhq.com/luma", category: "ai", atsType: "ashby", atsToken: "luma" },
  { name: "Pika", domain: "pika.art", careersUrl: "https://jobs.ashbyhq.com/pika", category: "ai", atsType: "ashby", atsToken: "pika" },
  { name: "Ideogram", domain: "ideogram.ai", careersUrl: "https://jobs.ashbyhq.com/ideogram", category: "ai", atsType: "ashby", atsToken: "ideogram" },
  // Lever more
  { name: "LaunchDarkly", domain: "launchdarkly.com", careersUrl: "https://jobs.lever.co/launchdarkly", category: "devtools", atsType: "lever", atsToken: "launchdarkly" },
  { name: "Split", domain: "split.io", careersUrl: "https://jobs.lever.co/split", category: "devtools", atsType: "lever", atsToken: "split" },
  { name: "Statsig", domain: "statsig.com", careersUrl: "https://jobs.lever.co/statsig", category: "devtools", atsType: "lever", atsToken: "statsig" },
  { name: "Amplitude", domain: "amplitude.com", careersUrl: "https://jobs.lever.co/amplitude", category: "saas", atsType: "lever", atsToken: "amplitude" },
  { name: "Mixpanel", domain: "mixpanel.com", careersUrl: "https://jobs.lever.co/mixpanel", category: "saas", atsType: "lever", atsToken: "mixpanel" },
  { name: "Heap", domain: "heap.io", careersUrl: "https://jobs.lever.co/heap", category: "saas", atsType: "lever", atsToken: "heap" },
  { name: "Pendo", domain: "pendo.io", careersUrl: "https://jobs.lever.co/pendo", category: "saas", atsType: "lever", atsToken: "pendo" },
  { name: "Gainsight", domain: "gainsight.com", careersUrl: "https://jobs.lever.co/gainsight", category: "enterprise", atsType: "lever", atsToken: "gainsight" },
  { name: "Algolia", domain: "algolia.com", careersUrl: "https://jobs.lever.co/algolia", category: "devtools", atsType: "lever", atsToken: "algolia" },
  { name: "Contentful", domain: "contentful.com", careersUrl: "https://jobs.lever.co/contentful", category: "saas", atsType: "lever", atsToken: "contentful" },
  // Greenhouse more
  { name: "Figma", domain: "figma.com", careersUrl: "https://boards.greenhouse.io/figma", category: "saas", atsType: "greenhouse", atsToken: "figma" },
  { name: "Canva", domain: "canva.com", careersUrl: "https://boards.greenhouse.io/canva", category: "saas", atsType: "greenhouse", atsToken: "canva" },
  { name: "Discord", domain: "discord.com", careersUrl: "https://boards.greenhouse.io/discord", category: "saas", atsType: "greenhouse", atsToken: "discord" },
  { name: "Reddit", domain: "reddit.com", careersUrl: "https://boards.greenhouse.io/reddit", category: "saas", atsType: "greenhouse", atsToken: "reddit" },
  { name: "Spotify GH", domain: "spotify.com", careersUrl: "https://boards.greenhouse.io/spotify", category: "enterprise", atsType: "greenhouse", atsToken: "spotify" },
  { name: "Dropbox", domain: "dropbox.com", careersUrl: "https://boards.greenhouse.io/dropbox", category: "saas", atsType: "greenhouse", atsToken: "dropbox" },
  { name: "Asana", domain: "asana.com", careersUrl: "https://boards.greenhouse.io/asana", category: "saas", atsType: "greenhouse", atsToken: "asana" },
  { name: "Monday.com", domain: "monday.com", careersUrl: "https://boards.greenhouse.io/mondaydotcom", category: "saas", atsType: "greenhouse", atsToken: "mondaydotcom" },
  { name: "HubSpot", domain: "hubspot.com", careersUrl: "https://boards.greenhouse.io/hubspot", category: "saas", atsType: "greenhouse", atsToken: "hubspot" },
  { name: "Intercom", domain: "intercom.com", careersUrl: "https://boards.greenhouse.io/intercom", category: "saas", atsType: "greenhouse", atsToken: "intercom" },
];

async function probeExtended(
  atsType: string,
  token: string,
  careersUrl: string,
): Promise<{
  result: ValidationResult["validationResult"];
  jobCount: number;
  engineeringJobs: number;
  remoteJobs: number;
  titles: string[];
}> {
  if (atsType === "greenhouse" || atsType === "lever" || atsType === "ashby") {
    const probe = await probeBoardLive(atsType, token, careersUrl);
    const titles = await fetchJobTitles(atsType, token);
    const eng = titles.filter((t) => ENGINEERING_RE.test(t)).length;
    const remote = titles.filter((t) => /\bremote\b/i.test(t)).length;
    return {
      result: probe.result,
      jobCount: probe.jobCount,
      engineeringJobs: eng,
      remoteJobs: remote,
      titles,
    };
  }

  if (atsType === "workable") {
    try {
      const r = await fetch(
        `https://apply.workable.com/api/v1/widget/accounts/${token}/jobs`,
        { headers: { "User-Agent": "JobLoom/1.0" }, signal: AbortSignal.timeout(8000) },
      );
      if (r.status === 404) return { result: "not_found", jobCount: 0, engineeringJobs: 0, remoteJobs: 0, titles: [] };
      if (!r.ok) return { result: "error", jobCount: 0, engineeringJobs: 0, remoteJobs: 0, titles: [] };
      const body = (await r.json()) as { results?: Array<{ title?: string; location?: { location_str?: string } }> };
      const jobs = body.results ?? [];
      const titles = jobs.map((j) => j.title ?? "");
      return {
        result: jobs.length > 0 ? "ok" : "empty",
        jobCount: jobs.length,
        engineeringJobs: titles.filter((t) => ENGINEERING_RE.test(t)).length,
        remoteJobs: jobs.filter((j) => /\bremote\b/i.test(j.location?.location_str ?? "")).length,
        titles,
      };
    } catch {
      return { result: "error", jobCount: 0, engineeringJobs: 0, remoteJobs: 0, titles: [] };
    }
  }

  if (atsType === "smartrecruiters") {
    try {
      const r = await fetch(
        `https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100`,
        { headers: { "User-Agent": "JobLoom/1.0" }, signal: AbortSignal.timeout(8000) },
      );
      if (r.status === 404) return { result: "not_found", jobCount: 0, engineeringJobs: 0, remoteJobs: 0, titles: [] };
      if (!r.ok) return { result: "error", jobCount: 0, engineeringJobs: 0, remoteJobs: 0, titles: [] };
      const body = (await r.json()) as { content?: Array<{ name?: string; location?: { remote?: boolean } }> };
      const jobs = body.content ?? [];
      const titles = jobs.map((j) => j.name ?? "");
      return {
        result: jobs.length > 0 ? "ok" : "empty",
        jobCount: jobs.length,
        engineeringJobs: titles.filter((t) => ENGINEERING_RE.test(t)).length,
        remoteJobs: jobs.filter((j) => j.location?.remote).length,
        titles,
      };
    } catch {
      return { result: "error", jobCount: 0, engineeringJobs: 0, remoteJobs: 0, titles: [] };
    }
  }

  if (atsType === "bamboohr") {
    try {
      const r = await fetch(`https://${token}.bamboohr.com/careers/list`, {
        signal: AbortSignal.timeout(8000),
      });
      if (r.status === 404) return { result: "not_found", jobCount: 0, engineeringJobs: 0, remoteJobs: 0, titles: [] };
      if (!r.ok) return { result: "error", jobCount: 0, engineeringJobs: 0, remoteJobs: 0, titles: [] };
      const ct = r.headers.get("content-type") ?? "";
      let titles: string[] = [];
      if (ct.includes("json")) {
        const body = (await r.json()) as { result?: Array<{ jobOpeningName?: string }> };
        titles = (body.result ?? []).map((j) => j.jobOpeningName ?? "");
      } else {
        const html = await r.text();
        titles = [...html.matchAll(/jobOpeningName['":\s]+([^<'"]+)/gi)].map((m) => m[1] ?? "");
      }
      return {
        result: titles.length > 0 ? "ok" : "empty",
        jobCount: titles.length,
        engineeringJobs: titles.filter((t) => ENGINEERING_RE.test(t)).length,
        remoteJobs: titles.filter((t) => /\bremote\b/i.test(t)).length,
        titles,
      };
    } catch {
      return { result: "error", jobCount: 0, engineeringJobs: 0, remoteJobs: 0, titles: [] };
    }
  }

  if (atsType === "teamtailor") {
    try {
      const r = await fetch(
        `https://api.teamtailor.com/v1/jobs?filter[site]=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!r.ok) {
        const fb = await fetch(`https://${token}.teamtailor.com/jobs`, { signal: AbortSignal.timeout(8000) });
        if (!fb.ok) return { result: "not_found", jobCount: 0, engineeringJobs: 0, remoteJobs: 0, titles: [] };
        const html = await fb.text();
        const count = (html.match(/\/jobs\//g) ?? []).length;
        return { result: count > 0 ? "ok" : "empty", jobCount: count, engineeringJobs: 0, remoteJobs: 0, titles: [] };
      }
      const body = (await r.json()) as { data?: unknown[] };
      const n = body.data?.length ?? 0;
      return { result: n > 0 ? "ok" : "empty", jobCount: n, engineeringJobs: 0, remoteJobs: 0, titles: [] };
    } catch {
      return { result: "error", jobCount: 0, engineeringJobs: 0, remoteJobs: 0, titles: [] };
    }
  }

  if (atsType === "workday") {
    try {
      const { workdayCrawler } = await import("../../src/modules/ats/workday/workday.crawler.js");
      const jobs = await workdayCrawler.fetchJobs(token);
      const titles = jobs.map((j) => j.title ?? "");
      return {
        result: jobs.length > 0 ? "ok" : "empty",
        jobCount: jobs.length,
        engineeringJobs: titles.filter((t) => ENGINEERING_RE.test(t)).length,
        remoteJobs: titles.filter((t) => /\bremote\b/i.test(t)).length,
        titles,
      };
    } catch {
      return { result: "error", jobCount: 0, engineeringJobs: 0, remoteJobs: 0, titles: [] };
    }
  }

  return { result: "unparseable", jobCount: 0, engineeringJobs: 0, remoteJobs: 0, titles: [] };
}

async function fetchJobTitles(atsType: string, token: string): Promise<string[]> {
  try {
    if (atsType === "greenhouse") {
      const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`, {
        headers: { "User-Agent": "JobLoom/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return [];
      const body = (await r.json()) as { jobs?: Array<{ title?: string }> };
      return (body.jobs ?? []).map((j) => j.title ?? "");
    }
    if (atsType === "lever") {
      const r = await fetch(`https://api.lever.co/v0/postings/${token}?mode=json`, {
        headers: { "User-Agent": "JobLoom/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return [];
      const jobs = (await r.json()) as Array<{ text?: string }>;
      return Array.isArray(jobs) ? jobs.map((j) => j.text ?? "") : [];
    }
    if (atsType === "ashby") {
      const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${token}`, {
        headers: { "User-Agent": "JobLoom/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return [];
      const body = (await r.json()) as { jobs?: Array<{ title?: string; isRemote?: boolean }> };
      return (body.jobs ?? []).map((j) => j.title ?? "");
    }
  } catch {
    return [];
  }
  return [];
}

function scoreCandidate(v: {
  jobCount: number;
  engineeringJobs: number;
  remoteJobs: number;
  atsType: string;
  category: string;
}): number {
  let score = 0;
  score += Math.min(v.jobCount * 2, 40);
  score += Math.min(v.engineeringJobs * 5, 30);
  score += Math.min(v.remoteJobs * 3, 15);
  // Underrepresented ATS bonus
  if (["workable", "bamboohr", "smartrecruiters", "teamtailor", "jobvite", "rippling"].includes(v.atsType)) {
    score += 10;
  }
  if (["ai", "devtools", "cybersecurity", "fintech"].includes(v.category)) score += 5;
  return score;
}

function normDomain(d: string): string {
  return d.toLowerCase().replace(/^www\./, "").trim();
}

async function main() {
  const existingCompanies = await prisma.$queryRaw<
    { domain: string | null; name: string; slug: string | null }[]
  >`
    SELECT LOWER(domain) AS domain, LOWER(name) AS name, LOWER(slug) AS slug FROM "Company"
  `;
  const existingEndpoints = await prisma.$queryRaw<
    { type: string; slug: string }[]
  >`SELECT type, LOWER(slug) AS slug FROM "AtsEndpoint"`;

  const domainSet = new Set(existingCompanies.map((c) => c.domain).filter(Boolean) as string[]);
  const nameSet = new Set(existingCompanies.map((c) => c.name));
  const slugSet = new Set(existingEndpoints.map((e) => `${e.type}:${e.slug}`));

  const foundExisting: ValidationResult[] = [];
  const newCandidates: CandidateInput[] = [];

  // Dedupe candidates by domain
  const seenDomains = new Set<string>();
  const uniqueCandidates = CANDIDATES.filter((c) => {
    const d = normDomain(c.domain);
    if (seenDomains.has(d)) return false;
    seenDomains.add(d);
    return true;
  });

  console.error(`Total candidates: ${uniqueCandidates.length}`);

  for (const c of uniqueCandidates) {
    const domain = normDomain(c.domain);
    const atsType = c.atsType ?? detectAtsTypeFromUrl(c.careersUrl) ?? "";
    const parsed = c.atsToken
      ? parseCrawlableBoard(atsType as AtsType, c.atsToken, c.careersUrl)
      : null;

    const slug = parsed?.slug ?? c.atsToken ?? "";
    const slugKey = `${atsType}:${slug.toLowerCase()}`;

    const reasons: string[] = [];
    if (domainSet.has(domain)) reasons.push("company_domain_exists");
    if (nameSet.has(c.name.toLowerCase())) reasons.push("company_name_exists");
    if (slugSet.has(slugKey)) reasons.push("endpoint_slug_exists");

    if (reasons.length > 0) {
      foundExisting.push({
        company: c.name,
        domain: c.domain,
        careersUrl: c.careersUrl,
        category: c.category,
        atsType,
        atsToken: c.atsToken ?? "",
        endpointUrl: parsed?.baseUrl ?? c.careersUrl,
        slug,
        jobCount: 0,
        engineeringJobs: 0,
        remoteJobs: 0,
        validationResult: "rejected_existing",
        rejectionReason: reasons.join(", "),
        score: 0,
        reasonSelected: "rejected — already in system",
      });
      continue;
    }

    if (!c.atsToken || !atsType) {
      // Try to extract from careers page
      const meta = await fetchCareersHtmlWithMeta(c.careersUrl, 12_000);
      let token: string | null = null;
      const html = meta.html ?? "";
      const detected =
        detectAtsTypeFromUrl(c.careersUrl) ?? detectAtsTypeFromUrl(meta.finalUrl ?? "");
      if (html.length > 500 && detected) {
        if (detected === "greenhouse") token = extractGreenhouseToken(html, c.careersUrl);
        else if (detected === "lever") token = extractLeverToken(html, c.careersUrl);
        else if (detected === "ashby") token = extractAshbyToken(html, c.careersUrl);
        else if (detected === "workday") token = extractWorkdayToken(html, c.careersUrl);
      }
      if (!token) continue;
      c.atsType = detected as AtsType;
      c.atsToken = token;
    }

    newCandidates.push(c);
  }

  console.error(`FOUND_EXISTING: ${foundExisting.length}`);
  console.error(`NEW_COMPANY_CANDIDATES: ${newCandidates.length}`);

  const validated: ValidationResult[] = [];
  const rejected: ValidationResult[] = [];

  for (let i = 0; i < newCandidates.length; i++) {
    const c = newCandidates[i]!;
    const atsType = c.atsType!;
    const token = c.atsToken!;
    const parsed = parseCrawlableBoard(atsType, token, c.careersUrl);

    if (!parsed) {
      rejected.push({
        company: c.name,
        domain: c.domain,
        careersUrl: c.careersUrl,
        category: c.category,
        atsType,
        atsToken: token,
        endpointUrl: c.careersUrl,
        slug: token,
        jobCount: 0,
        engineeringJobs: 0,
        remoteJobs: 0,
        validationResult: "unparseable",
        rejectionReason: "parseCrawlableBoard failed",
        score: 0,
        reasonSelected: "rejected — unparseable token",
      });
      continue;
    }

    // Re-check slug after parsing
    const slugKey = `${parsed.type}:${parsed.slug.toLowerCase()}`;
    if (slugSet.has(slugKey)) {
      foundExisting.push({
        company: c.name,
        domain: c.domain,
        careersUrl: c.careersUrl,
        category: c.category,
        atsType: parsed.type,
        atsToken: token,
        endpointUrl: parsed.baseUrl,
        slug: parsed.slug,
        jobCount: 0,
        engineeringJobs: 0,
        remoteJobs: 0,
        validationResult: "rejected_existing",
        rejectionReason: "endpoint_slug_exists_post_parse",
        score: 0,
        reasonSelected: "rejected — slug collision",
      });
      continue;
    }

    const probe = await probeExtended(parsed.type, token, c.careersUrl);

    const entry: ValidationResult = {
      company: c.name,
      domain: c.domain,
      careersUrl: c.careersUrl,
      category: c.category,
      atsType: parsed.type,
      atsToken: token,
      endpointUrl: parsed.baseUrl,
      slug: parsed.slug,
      jobCount: probe.jobCount,
      engineeringJobs: probe.engineeringJobs,
      remoteJobs: probe.remoteJobs,
      validationResult: probe.result,
      score: 0,
      reasonSelected: "",
    };

    if (probe.result !== "ok" || probe.jobCount === 0) {
      entry.rejectionReason = `validation failed: ${probe.result}`;
      entry.reasonSelected = `rejected — ${probe.result}`;
      rejected.push(entry);
    } else {
      entry.score = scoreCandidate({
        jobCount: probe.jobCount,
        engineeringJobs: probe.engineeringJobs,
        remoteJobs: probe.remoteJobs,
        atsType: parsed.type,
        category: c.category,
      });
      entry.reasonSelected = `active hiring: ${probe.jobCount} jobs (${probe.engineeringJobs} eng, ${probe.remoteJobs} remote); ${c.category}; underrepresented ATS bonus`;
      validated.push(entry);
      slugSet.add(slugKey); // prevent duplicate slugs in same batch
    }

    if ((i + 1) % 10 === 0) console.error(`Validated ${i + 1}/${newCandidates.length}...`);
    await new Promise((r) => setTimeout(r, 300));
  }

  validated.sort((a, b) => b.score - a.score);
  const top50 = validated.slice(0, 50);

  const currentActive = Number(
    (
      await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM "AtsEndpoint" WHERE "isActive"`
    )[0]?.c ?? 0,
  );
  const currentJobs = Number(
    (await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM "Job"`)[0]?.c ?? 0,
  );

  const estMonthlyJobs = top50.reduce((s, v) => s + v.jobCount * 0.3, 0);
  const estDailyJobs = estMonthlyJobs / 30;

  const report = {
    phase: "PHASE_6_HUMAN_AUDIT_REPORT",
    generatedAt: new Date().toISOString(),
    status: "AWAITING_APPROVAL — NO DATABASE CHANGES MADE",
    summary: {
      candidatesResearched: uniqueCandidates.length,
      foundExisting: foundExisting.length,
      newCandidatesChecked: newCandidates.length,
      validatedPassed: validated.length,
      validatedFailed: rejected.length,
      top50Selected: top50.length,
      currentActiveEndpoints: currentActive,
      currentTotalJobs: currentJobs,
      estimatedCoverageIncrease: {
        newActiveEndpoints: top50.length,
        pctEndpointIncrease: ((top50.length / currentActive) * 100).toFixed(1) + "%",
        estimatedMonthlyNewJobs: Math.round(estMonthlyJobs),
        estimatedDailyNewJobs: Math.round(estDailyJobs * 10) / 10,
      },
    },
    top50,
    validatedAll: validated,
    rejectedSample: rejected.slice(0, 30),
    foundExistingSample: foundExisting.slice(0, 30),
    foundExistingCount: foundExisting.length,
    rejectedCount: rejected.length,
  };

  const outPath = "/tmp/coverage-expansion-50-audit.json";
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error(`\nReport written to ${outPath}`);
  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
