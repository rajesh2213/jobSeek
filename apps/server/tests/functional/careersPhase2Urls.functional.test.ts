/**
 * Network: validates careers URL prefilter + Phase 2 extraction/validation (and optional self-heal).
 * Run: npm run test:functional -w @jobseek/server
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchCareersHtmlWithMeta } from "../../src/utils/fetchCareersHtml.js";
import {
  extractJobDescriptionFromHtml,
  extractJobLocationFromHtml,
  extractJobTitleFromHtml,
  extractJsonLdJobPostingFlags,
  extractJsonLdJobPostingStrict,
} from "../../src/utils/jobDetailHtml.js";
import {
  isStrongDenylistUrl,
  shouldFetchCareersJobDetail,
} from "../../src/utils/careersPageJobUrlFilter.js";
import { applyRetryStrategies } from "../../src/utils/jobRetryStrategies.js";
import { validateJob } from "../../src/utils/jobValidation.js";

const MIN_DESCRIPTION_CHARS = 120;
const FETCH_MS = 15_000;

type Expect = "invalid" | "valid";

const CASES: Array<{ url: string; expect: Expect; note: string }> = [
  {
    url: "https://www.cloudflare.com/developer-platform/products/r2/",
    expect: "invalid",
    note: "developer-platform product page",
  },
  {
    url: "https://www.cloudflare.com/careers/life-at-cloudflare/",
    expect: "invalid",
    note: "life-at hub",
  },
  {
    url: "https://www.cloudflare.com/careers/early-talent/",
    expect: "invalid",
    note: "early-talent hub",
  },
  {
    url: "https://flexa.careers/in/jobs/boomi-project-manager-professional-services-69d0d1ed6c8f83e287f4023a",
    expect: "valid",
    note: "Flexa job",
  },
  {
    url: "https://asana.com/jobs/apply/7477015",
    expect: "valid",
    note: "Asana apply",
  },
  {
    url: "https://www.smartsheet.com/careers/position/7789367/account-executive-commercial-mid-market",
    expect: "valid",
    note: "Smartsheet position",
  },
];

function extractTitleFromUrlSlug(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    const decoded = decodeURIComponent(last.replace(/\.[a-z0-9]+$/i, ""));
    let s = decoded.replace(/[-_%23]+/g, " ").trim();
    s = s.replace(/[_-]?(?:jr|req)[_-]?\d+/gi, " ").replace(/\s+/g, " ").trim();
    s = s.replace(/\s+\d+$/g, "").trim();
    return s || "Job Role";
  } catch {
    return "Job Role";
  }
}

function wouldIngestAfterPipeline(
  html: string,
  link: string,
): { ok: boolean; detail: string } {
  const jsonLd = extractJsonLdJobPostingFlags(html);
  const strictDesc = process.env.CAREERS_PAGE_STRICT_DESCRIPTION === "1";
  const { text: description } = extractJobDescriptionFromHtml(html, {
    careersPageStrict: strictDesc,
  });
  const titleFromHtml = extractJobTitleFromHtml(html, jsonLd);
  const title = titleFromHtml ?? extractTitleFromUrlSlug(link);
  const locationLine = extractJobLocationFromHtml(html, jsonLd) ?? undefined;

  const v = validateJob({
    title,
    description,
    location: locationLine,
    sourceUrl: link,
    hasJsonLdJobPosting: jsonLd.hasJobPosting,
  });

  if (v.isValid && description.length >= MIN_DESCRIPTION_CHARS) {
    return { ok: true, detail: `pass score=${v.score}` };
  }

  if (v.isValid && description.length < MIN_DESCRIPTION_CHARS) {
    return {
      ok: false,
      detail: `valid score but desc ${description.length} < ${MIN_DESCRIPTION_CHARS}`,
    };
  }

  let recovered = false;
  if (v.score >= 20 && !isStrongDenylistUrl(link)) {
    const retry = applyRetryStrategies({
      html,
      sourceUrl: link,
      previousReasons: v.reasons,
      initialScore: v.score,
      primary: { title, description, location: locationLine },
    });
    if (retry) {
      const strictJp =
        retry.strategyUsed === "jsonld_only" ? extractJsonLdJobPostingStrict(html) : null;
      const v2 = validateJob({
        title: retry.title,
        description: retry.description,
        location: retry.location,
        sourceUrl: link,
        hasJsonLdJobPosting:
          retry.strategyUsed === "jsonld_only"
            ? Boolean(strictJp?.hasJobPosting)
            : jsonLd.hasJobPosting,
      });
      if (v2.isValid && (retry.description?.length ?? 0) >= MIN_DESCRIPTION_CHARS) {
        recovered = true;
        return { ok: true, detail: `recovered via ${retry.strategyUsed} score=${v2.score}` };
      }
    }
  }

  if (!recovered) {
    return {
      ok: false,
      detail: `reject score=${v.score} reasons=${v.reasons.slice(0, 6).join(",")}${v.reasons.length > 6 ? "…" : ""}`,
    };
  }
  return { ok: false, detail: "unexpected" };
}

describe("careers Phase 2 / 2.5 URL checks (network)", () => {
  for (const { url, expect, note } of CASES) {
    it(`${expect}: ${note} (${url})`, async () => {
      const fetchOk = shouldFetchCareersJobDetail(url);

      if (!fetchOk) {
        assert.equal(
          expect,
          "invalid",
          "prefilter should reject only invalid expectations",
        );
        return;
      }

      const meta = await fetchCareersHtmlWithMeta(url, FETCH_MS);
      assert.ok(meta.fetched && meta.html, meta.error ?? "empty html");

      const { ok, detail } = wouldIngestAfterPipeline(meta.html!, url);
      const expectOk = expect === "valid";
      assert.equal(ok, expectOk, detail);
    });
  }
});
