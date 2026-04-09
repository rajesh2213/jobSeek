import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractJobLocationFromHtml,
  extractJsonLdJobPostingFlags,
  extractLocationCandidates,
  selectBestLocationCandidate,
} from "../../../src/utils/jobDetailHtml.js";

function oktaLikeHtml(locationLine: string): string {
  return `<!DOCTYPE html><html><head>
<meta property="og:site_name" content="Okta" />
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"JobPosting","title":"Senior Data Platform Engineer (Bengaluru)"}
</script></head><body>
<div class="job-post-location">${locationLine}</div>
<main><p>Job description here.</p></main>
</body></html>`;
}

describe("extractLocationCandidates + extractJobLocationFromHtml", () => {
  it("prefers dom_attr_location City, Region for Okta-style page without JSON-LD jobLocation", () => {
    const html = oktaLikeHtml("San Francisco, California");
    const jp = extractJsonLdJobPostingFlags(html);
    assert.equal(jp.locationLine, undefined);
    const cands = extractLocationCandidates(html, jp);
    const site = "Okta";
    const best = selectBestLocationCandidate(cands, site);
    assert.ok(best && best.score >= 40);
    assert.equal(best!.text, "San Francisco, California");
    assert.equal(extractJobLocationFromHtml(html, jp), "San Francisco, California");
  });

  it("extracts Warsaw, Poland from dom location div", () => {
    const html = oktaLikeHtml("Warsaw, Poland");
    const jp = extractJsonLdJobPostingFlags(html);
    assert.equal(extractJobLocationFromHtml(html, jp), "Warsaw, Poland");
  });

  it("extracts Bengaluru, India from dom location div", () => {
    const html = oktaLikeHtml("Bengaluru, India");
    const jp = extractJsonLdJobPostingFlags(html);
    assert.equal(extractJobLocationFromHtml(html, jp), "Bengaluru, India");
  });

  it("Flexa-like data-testid=job-location", () => {
    const html = `<html><head><meta property="og:site_name" content="Flexa" /></head><body>
<div data-testid="job-location">München, Bayern, Germany</div>
<main><p>Long enough description text for the page content area here.</p></main>
</body></html>`;
    const jp = extractJsonLdJobPostingFlags(html);
    assert.equal(extractJobLocationFromHtml(html, jp), "München, Bayern, Germany");
  });

  it("regex-only: Austin, Texas in main", () => {
    const html = `<html><body><main>
<p>We are hiring.</p>
<p>Austin, Texas</p>
<p>More details follow in the body of the job posting.</p>
</main></body></html>`;
    const jp = extractJsonLdJobPostingFlags(html);
    assert.equal(extractJobLocationFromHtml(html, jp), "Austin, Texas");
  });

  it("does not pick junk Xs,version over a good City, Region in location div", () => {
    const html = `<html><head><meta property="og:site_name" content="Okta" /></head><body>
<p>Xs,version</p>
<div class="job-location">Bengaluru, India</div>
</body></html>`;
    const jp = extractJsonLdJobPostingFlags(html);
    assert.equal(extractJobLocationFromHtml(html, jp), "Bengaluru, India");
  });

  it("returns JSON-LD jobLocation immediately when present", () => {
    const html = `<script type="application/ld+json">
{"@context":"https://schema.org","@type":"JobPosting","jobLocation":{"address":{"addressLocality":"Dublin","addressCountry":"IE"}}}
</script>`;
    const jp = extractJsonLdJobPostingFlags(html);
    assert.ok(jp.locationLine?.includes("Dublin"));
    assert.equal(extractJobLocationFromHtml(html, jp), jp.locationLine?.trim() ?? null);
  });

  it("legacy fallback when scored pipeline finds nothing above threshold", () => {
    const html = `<html><body><p>No comma location here at all just prose.</p></body></html>`;
    assert.equal(extractJobLocationFromHtml(html), null);
  });
});
