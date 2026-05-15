import assert from "node:assert/strict";
import test from "node:test";
import { companyDisplayName } from "../../../src/utils/companyDisplayName.js";
import { pickCanonicalCompany } from "../../../src/utils/companyCanonical.js";

test("companyDisplayName repairs truncated REDDI via reddit.com domain", () => {
  assert.equal(companyDisplayName("REDDI", "reddit.com"), "Reddit");
});

test("companyDisplayName leaves unrelated short names unchanged", () => {
  assert.equal(companyDisplayName("Meta", "meta.com"), "Meta");
});

test("pickCanonicalCompany prefers api_manual Reddit over csv_seed REDDI", () => {
  const picked = pickCanonicalCompany([
    {
      id: "bad",
      name: "REDDI",
      domain: "reddit.com",
      discoverySource: "csv_seed",
      isCompanyVerified: null,
      status: "ready",
      atsType: "greenhouse",
      atsBoardToken: "reddit",
    },
    {
      id: "good",
      name: "Reddit",
      domain: "redditinc.com",
      discoverySource: "api_manual",
      isCompanyVerified: null,
      status: "ready",
      atsType: "greenhouse",
      atsBoardToken: "reddit",
    },
  ]);
  assert.equal(picked?.id, "good");
});
