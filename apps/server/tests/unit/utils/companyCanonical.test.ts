import assert from "node:assert/strict";
import test from "node:test";
import { pickCanonicalCompany, scoreCompanyCanonicalPreference } from "../../../src/utils/companyCanonical.js";

test("scoreCompanyCanonicalPreference ranks api_manual higher than csv_seed", () => {
  const good = scoreCompanyCanonicalPreference({
    id: "1",
    name: "Reddit",
    domain: "redditinc.com",
    discoverySource: "api_manual",
    isCompanyVerified: null,
    status: "ready",
    atsType: "greenhouse",
    atsBoardToken: "reddit",
  });
  const bad = scoreCompanyCanonicalPreference({
    id: "2",
    name: "REDDI",
    domain: "reddit.com",
    discoverySource: "csv_seed",
    isCompanyVerified: null,
    status: "ready",
    atsType: "greenhouse",
    atsBoardToken: "reddit",
  });
  assert.ok(good > bad);
});

test("pickCanonicalCompany returns sole candidate", () => {
  const only = {
    id: "x",
    name: "Acme",
    domain: "acme.com",
    discoverySource: "job_ingestion",
    isCompanyVerified: null,
    status: "ready",
    atsType: "greenhouse",
    atsBoardToken: "acme",
  };
  assert.equal(pickCanonicalCompany([only])?.id, "x");
});
