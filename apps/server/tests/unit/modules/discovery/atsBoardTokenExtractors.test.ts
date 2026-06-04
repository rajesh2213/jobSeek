import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractAshbyToken } from "../../../../src/modules/discovery/extractors/ashby.extractor.js";
import { extractGreenhouseToken } from "../../../../src/modules/discovery/extractors/greenhouse.extractor.js";
import { extractLeverToken } from "../../../../src/modules/discovery/extractors/lever.extractor.js";
import { extractWorkdayToken } from "../../../../src/modules/discovery/extractors/workday.extractor.js";
import { isInvalidAtsBoardToken } from "../../../../src/modules/discovery/extractors/atsTokenValidation.js";
import { extractAtsToken } from "../../../../src/modules/discovery/detectors/ats.detector.js";
import { parseCrawlableBoard } from "../../../../src/modules/atsDiscovery/atsUrlParser.js";

describe("isInvalidAtsBoardToken", () => {
  it("rejects generic slugs", () => {
    for (const t of ["posting-api", "embed", "login", "jobs", "careers"]) {
      assert.equal(isInvalidAtsBoardToken(t), true);
    }
  });

  it("accepts real slugs", () => {
    assert.equal(isInvalidAtsBoardToken("vanta"), false);
    assert.equal(isInvalidAtsBoardToken("figment"), false);
  });
});

describe("extractAshbyToken", () => {
  it("extracts org slug from jobs.ashbyhq.com link", () => {
    const html = `<a href="https://jobs.ashbyhq.com/synthesia">Jobs</a>`;
    assert.equal(extractAshbyToken(html, null), "synthesia");
  });

  it("does not return posting-api from API URL", () => {
    const html = `https://app.ashbyhq.com/api/posting-api/job-board/foo`;
    assert.equal(extractAshbyToken(html, null), "foo");
  });

  it("extracts from app.ashbyhq.com org path", () => {
    const html = `https://app.ashbyhq.com/kota/jobs`;
    assert.equal(extractAshbyToken(html, null), "kota");
  });

  it("returns null when only posting-api path present", () => {
    const html = `src="https://api.ashbyhq.com/posting-api/v1/board"`;
    assert.equal(extractAshbyToken(html, null), null);
  });

  it("never returns posting-api as slug", () => {
    const html = `https://jobs.ashbyhq.com/posting-api`;
    assert.equal(extractAshbyToken(html, null), null);
  });
});

describe("extractGreenhouseToken", () => {
  it("extracts board from boards.greenhouse.io", () => {
    const html = `<script src="https://boards.greenhouse.io/figment/embed"></script>`;
    assert.equal(extractGreenhouseToken(html, null), "figment");
  });

  it("extracts for= from embed job_board URL", () => {
    const html = `iframe src="https://boards.greenhouse.io/embed/job_board?for=acme-corp"`;
    assert.equal(extractGreenhouseToken(html, null), "acme-corp");
  });

  it("extracts boardToken from JSON config", () => {
    const html = `"boardToken":"circleci"`;
    assert.equal(extractGreenhouseToken(html, null), "circleci");
  });

  it("extracts from job-boards host", () => {
    const html = `https://job-boards.greenhouse.io/mentimeter`;
    assert.equal(extractGreenhouseToken(html, null), "mentimeter");
  });

  it("does not return embed as token", () => {
    const html = `https://boards.greenhouse.io/embed/job_board`;
    assert.equal(extractGreenhouseToken(html, null), null);
  });
});

describe("extractLeverToken", () => {
  it("extracts company slug", () => {
    const html = `<a href="https://jobs.lever.co/tradelink">`;
    assert.equal(extractLeverToken(html, null), "tradelink");
  });

  it("extracts from api.lever.co postings URL", () => {
    const html = `"https://api.lever.co/v0/postings/clever?mode=json"`;
    assert.equal(extractLeverToken(html, null), "clever");
  });

  it("extracts postingOrgSlug from JSON", () => {
    const html = `{"postingOrgSlug":"jumpcloud","other":1}`;
    assert.equal(extractLeverToken(html, null), "jumpcloud");
  });

  it("rejects generic paths", () => {
    const html = `https://jobs.lever.co/jobs/careers`;
    assert.equal(extractLeverToken(html, null), null);
  });
});

describe("extractWorkdayToken", () => {
  it("rejects login site", () => {
    const html = `https://empower.wd12.myworkdayjobs.com/empower/login`;
    assert.equal(extractWorkdayToken(html, null), null);
  });

  it("accepts real careers site", () => {
    const html = `https://gilead.wd1.myworkdayjobs.com/gileadcareers`;
    const tok = extractWorkdayToken(html, null);
    assert.ok(tok);
    assert.ok(tok!.includes("gileadcareers"));
    assert.ok(!tok!.includes("login"));
  });

  it("parses workday config from JSON blob", () => {
    const html = `{"careerSite":"Generalmills","host":"generalmills.wd5.myworkdayjobs.com"}`;
    const tok = extractWorkdayToken(html, null);
    assert.ok(tok);
    assert.ok(tok!.includes("generalmills"));
    assert.ok(tok!.includes("Generalmills") || tok!.includes("generalmills"));
  });

  it("rejects signin path", () => {
    const html = `https://foo.wd1.myworkdayjobs.com/foo/signin`;
    assert.equal(extractWorkdayToken(html, null), null);
  });
});

describe("extractAtsToken (detector)", () => {
  it("greenhouse embed uses for param not embed path", () => {
    const url = "https://boards.greenhouse.io/embed/job_board?for=my-co";
    assert.equal(extractAtsToken(url, "greenhouse"), "my-co");
  });
});

describe("parseCrawlableBoard", () => {
  it("rejects posting-api as ashby slug fallback", () => {
    assert.equal(parseCrawlableBoard("ashby", "posting-api", null), null);
  });

  it("rejects embed as greenhouse slug fallback", () => {
    assert.equal(parseCrawlableBoard("greenhouse", "embed", null), null);
  });

  it("parses real ashby slug", () => {
    const r = parseCrawlableBoard("ashby", "vanta", null);
    assert.equal(r?.slug, "vanta");
  });
});
