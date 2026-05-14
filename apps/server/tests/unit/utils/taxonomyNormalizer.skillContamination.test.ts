import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeSkills,
  normalizeJobAttributes,
  filterSkillsByDomainContradiction,
} from "../../../src/utils/taxonomyNormalizer.js";
import {
  SKILL_ALIAS_ENTRIES,
  SKILL_ALIAS_MAP,
  MIN_ALIAS_LENGTH,
  type AliasMode,
} from "../../../src/config/taxonomy.js";

describe("normalizeSkills — word-boundary safety", () => {
  it("does NOT extract 'typescript' from 'patients'", () => {
    const skills = normalizeSkills("We need patients to feel comfortable");
    assert.ok(!skills.includes("typescript"), `got unexpected: ${skills}`);
  });

  it("does NOT extract 'typescript' from 'results'", () => {
    const skills = normalizeSkills("The results of the blood test");
    assert.ok(!skills.includes("typescript"), `got unexpected: ${skills}`);
  });

  it("does NOT extract 'aws' from 'draws'", () => {
    const skills = normalizeSkills("Phlebotomist draws blood from patients");
    assert.ok(!skills.includes("aws"), `got unexpected: ${skills}`);
  });

  it("does NOT extract 'aws' from 'laws'", () => {
    const skills = normalizeSkills("Must comply with local laws and regulations");
    assert.ok(!skills.includes("aws"), `got unexpected: ${skills}`);
  });

  it("does NOT extract 'golang' from 'ongoing'", () => {
    const skills = normalizeSkills("Ongoing training and development provided");
    assert.ok(!skills.includes("golang"), `got unexpected: ${skills}`);
  });

  it("does NOT extract 'nodejs' from 'lymph node'", () => {
    const skills = normalizeSkills("Sentinel lymph node biopsy experience preferred");
    assert.ok(!skills.includes("nodejs"), `got unexpected: ${skills}`);
  });

  it("does NOT extract 'nextjs' from 'next steps'", () => {
    const skills = normalizeSkills("The next steps in the hiring process");
    assert.ok(!skills.includes("nextjs"), `got unexpected: ${skills}`);
  });

  it("does NOT extract 'customer-support' from 'life support'", () => {
    const skills = normalizeSkills("Advanced cardiac life support certification");
    assert.ok(!skills.includes("customer-support"), `got unexpected: ${skills}`);
  });

  it("does NOT extract 'elasticsearch' from 'elastic bandage'", () => {
    const skills = normalizeSkills("Apply elastic bandage to wound site");
    assert.ok(!skills.includes("elasticsearch"), `got unexpected: ${skills}`);
  });

  it("does NOT extract 'spring' from 'spring 2024'", () => {
    const skills = normalizeSkills("Starting spring 2024 orientation program");
    assert.ok(!skills.includes("spring"), `got unexpected: ${skills}`);
  });

  it("DOES extract 'aws' from standalone 'AWS'", () => {
    const skills = normalizeSkills("Experience with AWS cloud infrastructure");
    assert.ok(skills.includes("aws"), `missing aws: ${skills}`);
  });

  it("DOES extract 'typescript' from standalone 'TypeScript'", () => {
    const skills = normalizeSkills("Proficiency in TypeScript required");
    assert.ok(skills.includes("typescript"), `missing typescript: ${skills}`);
  });

  it("DOES extract 'golang' from standalone 'Golang'", () => {
    const skills = normalizeSkills("Strong Golang experience preferred");
    assert.ok(skills.includes("golang"), `missing golang: ${skills}`);
  });

  it("DOES extract 'python' from standalone 'Python'", () => {
    const skills = normalizeSkills("Python and SQL required");
    assert.ok(skills.includes("python"), `missing python: ${skills}`);
  });

  it("DOES extract 'nodejs' from 'Node.js'", () => {
    const skills = normalizeSkills("Experience with Node.js and Express");
    assert.ok(skills.includes("nodejs"), `missing nodejs: ${skills}`);
  });

  it("DOES extract 'react' from 'React.js'", () => {
    const skills = normalizeSkills("Built frontends with React.js and Redux");
    assert.ok(skills.includes("react"), `missing react: ${skills}`);
  });

  it("DOES extract 'kubernetes' from 'k8s'", () => {
    const skills = normalizeSkills("Deploy services to k8s clusters");
    assert.ok(skills.includes("kubernetes"), `missing kubernetes: ${skills}`);
  });

  it("DOES extract 'spring' from 'Spring Boot'", () => {
    const skills = normalizeSkills("Java Spring Boot microservices");
    assert.ok(skills.includes("spring"), `missing spring: ${skills}`);
  });

  it("DOES extract 'amazon web services' correctly", () => {
    const skills = normalizeSkills("Deployed on Amazon Web Services");
    assert.ok(skills.includes("aws"), `missing aws: ${skills}`);
  });
});

describe("normalizeSkills — healthcare job descriptions produce zero tech skills", () => {
  const PHLEBOTOMIST_DESC = [
    "Sr Phlebotomist – Bowie, MD",
    "We are looking for an experienced phlebotomist to join our team.",
    "Responsibilities: Draws blood from patients using venipuncture and",
    "capillary techniques. Labels specimens and transports to the laboratory.",
    "Must comply with all OSHA and HIPAA laws and regulations.",
    "Ongoing training provided. Benefits include healthcare coverage.",
    "The next step after applying is a phone screen.",
    "Results-oriented team player with strong attention to detail.",
    "Must have valid phlebotomy certification. Go to our careers page for more.",
  ].join("\n");

  it("phlebotomist description returns no software skills", () => {
    const skills = normalizeSkills(PHLEBOTOMIST_DESC);
    const softwareSkills = ["typescript", "aws", "golang", "nodejs", "nextjs",
      "react", "python", "java", "kubernetes", "docker"];
    for (const sw of softwareSkills) {
      assert.ok(!skills.includes(sw), `unexpected skill '${sw}' found in: ${skills}`);
    }
  });
});

describe("normalizeSkills — software job descriptions extract correctly", () => {
  const SOFTWARE_DESC = [
    "Senior Software Engineer",
    "Requirements: 5+ years experience with TypeScript and React.",
    "Strong proficiency in Node.js, PostgreSQL, and Redis.",
    "Experience with AWS (EC2, S3, Lambda) and Docker.",
    "Familiarity with Kubernetes and CI/CD pipelines.",
    "Experience with Python for scripting is a plus.",
  ].join("\n");

  it("extracts expected tech skills from software job", () => {
    const skills = normalizeSkills(SOFTWARE_DESC);
    assert.ok(skills.includes("typescript"), `missing typescript: ${skills}`);
    assert.ok(skills.includes("nodejs"), `missing nodejs: ${skills}`);
    assert.ok(skills.includes("postgres"), `missing postgres: ${skills}`);
    assert.ok(skills.includes("redis"), `missing redis: ${skills}`);
    assert.ok(skills.includes("aws"), `missing aws: ${skills}`);
    assert.ok(skills.includes("docker"), `missing docker: ${skills}`);
    assert.ok(skills.includes("kubernetes"), `missing kubernetes: ${skills}`);
    assert.ok(skills.includes("python"), `missing python: ${skills}`);
  });

  it("does NOT extract nursing/phlebotomy from software job", () => {
    const skills = normalizeSkills(SOFTWARE_DESC);
    assert.ok(!skills.includes("nursing"), `unexpected nursing: ${skills}`);
  });
});

describe("filterSkillsByDomainContradiction", () => {
  it("strips software skills from phlebotomist title", () => {
    const skills = ["aws", "typescript", "golang", "nursing", "excel"];
    const filtered = filterSkillsByDomainContradiction(skills, "Sr Phlebotomist – Bowie, MD");
    assert.ok(!filtered.includes("aws"));
    assert.ok(!filtered.includes("typescript"));
    assert.ok(!filtered.includes("golang"));
    assert.ok(filtered.includes("nursing"));
    assert.ok(filtered.includes("excel"));
  });

  it("strips software-only skills from nurse title but keeps cross-domain tools", () => {
    const filtered = filterSkillsByDomainContradiction(
      ["python", "react", "sql", "nursing"],
      "Registered Nurse – ICU",
    );
    assert.ok(filtered.includes("python"), "python is cross-domain, should be kept");
    assert.ok(!filtered.includes("react"), "react is software-only, should be removed");
    assert.ok(filtered.includes("sql"), "sql is cross-domain, should be kept");
    assert.ok(filtered.includes("nursing"), "nursing should be kept");
  });

  it("does NOT strip skills from software engineer title", () => {
    const skills = ["aws", "typescript", "golang", "python"];
    const filtered = filterSkillsByDomainContradiction(skills, "Senior Software Engineer");
    assert.deepStrictEqual(filtered, skills);
  });

  it("does NOT strip skills from data analyst title", () => {
    const skills = ["python", "sql", "pandas", "tableau"];
    const filtered = filterSkillsByDomainContradiction(skills, "Data Analyst");
    assert.deepStrictEqual(filtered, skills);
  });

  it("does NOT strip skills from generic/other title", () => {
    const skills = ["python", "aws"];
    const filtered = filterSkillsByDomainContradiction(skills, "Operations Manager");
    assert.deepStrictEqual(filtered, skills);
  });

  it("strips software skills from dental hygienist", () => {
    const filtered = filterSkillsByDomainContradiction(
      ["kubernetes", "excel"],
      "Dental Hygienist",
    );
    assert.ok(!filtered.includes("kubernetes"));
    assert.ok(filtered.includes("excel"));
  });

  it("strips software skills from veterinary technician", () => {
    const filtered = filterSkillsByDomainContradiction(
      ["docker", "sql"],
      "Veterinary Technician",
    );
    assert.ok(!filtered.includes("docker"));
    assert.ok(filtered.includes("sql"));
  });
});

describe("normalizeJobAttributes — end-to-end skill safety", () => {
  it("healthcare job gets no software skills", () => {
    const result = normalizeJobAttributes({
      title: "Sr Phlebotomist – Bowie, MD",
      description: "Draws blood from patients. Must go to training sessions. Results-oriented.",
      location: "Bowie, MD",
      isRemote: false,
    });
    const bad = ["typescript", "aws", "golang", "nodejs", "nextjs"];
    for (const sw of bad) {
      assert.ok(!result.skills.includes(sw), `unexpected '${sw}' in: ${result.skills}`);
    }
  });

  it("software job keeps legitimate skills", () => {
    const result = normalizeJobAttributes({
      title: "Senior Backend Engineer",
      description: "Build APIs with TypeScript, Node.js, and PostgreSQL. Deploy to AWS with Docker.",
      location: "Remote",
      isRemote: true,
    });
    assert.ok(result.skills.includes("typescript"), `missing typescript: ${result.skills}`);
    assert.ok(result.skills.includes("nodejs"), `missing nodejs: ${result.skills}`);
    assert.ok(result.skills.includes("postgres"), `missing postgres: ${result.skills}`);
    assert.ok(result.skills.includes("aws"), `missing aws: ${result.skills}`);
    assert.ok(result.skills.includes("docker"), `missing docker: ${result.skills}`);
  });

  it("finance job keeps finance skills, no software contamination", () => {
    const result = normalizeJobAttributes({
      title: "Financial Analyst",
      description: "Analyze financial reports using Excel and SQL. Results-driven approach.",
      location: "New York, NY",
      isRemote: false,
    });
    assert.ok(result.skills.includes("excel"), `missing excel: ${result.skills}`);
    assert.ok(result.skills.includes("sql"), `missing sql: ${result.skills}`);
    assert.ok(!result.skills.includes("typescript"), `unexpected typescript: ${result.skills}`);
    assert.ok(!result.skills.includes("golang"), `unexpected golang: ${result.skills}`);
  });

  it("marketing job has no tech contamination from common English words", () => {
    const result = normalizeJobAttributes({
      title: "Marketing Manager",
      description: "Go-to-market strategy. Drive results across all channels. Support brand growth.",
      location: "San Francisco, CA",
      isRemote: false,
    });
    assert.ok(!result.skills.includes("golang"), `unexpected golang: ${result.skills}`);
    assert.ok(!result.skills.includes("typescript"), `unexpected typescript: ${result.skills}`);
    assert.ok(!result.skills.includes("nodejs"), `unexpected nodejs: ${result.skills}`);
  });

  it("sales job has no tech contamination", () => {
    const result = normalizeJobAttributes({
      title: "Enterprise Account Executive",
      description: "Manage enterprise accounts. Ongoing relationship building. Strong support skills.",
      location: "Chicago, IL",
      isRemote: false,
    });
    assert.ok(!result.skills.includes("golang"), `unexpected golang: ${result.skills}`);
    assert.ok(!result.skills.includes("typescript"), `unexpected typescript: ${result.skills}`);
  });
});

// ---------------------------------------------------------------------------
// Alias safety classification structural invariants
// ---------------------------------------------------------------------------

describe("SKILL_ALIAS_ENTRIES — structural safety invariants", () => {
  it("every short alias (< MIN_ALIAS_LENGTH) uses mode 'short-allow'", () => {
    for (const entry of SKILL_ALIAS_ENTRIES) {
      const len = entry.alias.replace(/[.\-#]/g, "").length;
      if (len < MIN_ALIAS_LENGTH) {
        assert.equal(
          entry.mode,
          "short-allow",
          `alias "${entry.alias}" (${len} chars) must be "short-allow", got "${entry.mode}"`,
        );
      }
    }
  });

  it("no alias is 1 or 2 raw characters (even with short-allow)", () => {
    const ABSOLUTE_MIN = 2;
    for (const entry of SKILL_ALIAS_ENTRIES) {
      assert.ok(
        entry.alias.length >= ABSOLUTE_MIN,
        `alias "${entry.alias}" is only ${entry.alias.length} char(s) — too short to ever be safe`,
      );
    }
  });

  it("multi-word aliases use mode 'phrase'", () => {
    for (const entry of SKILL_ALIAS_ENTRIES) {
      if (entry.alias.includes(" ")) {
        assert.equal(
          entry.mode,
          "phrase",
          `multi-word alias "${entry.alias}" should be "phrase", got "${entry.mode}"`,
        );
      }
    }
  });

  it("no banned common-English-word aliases are present", () => {
    const BANNED: readonly string[] = [
      "go", "ts", "ai", "c", "r", "node", "next", "react", "spring",
      "support", "elastic", "swift", "spark", "sap", "ios", "dbt", "scikit",
      "amazon",
    ];
    const aliasSet = new Set(SKILL_ALIAS_ENTRIES.map((e) => e.alias));
    for (const banned of BANNED) {
      assert.ok(
        !aliasSet.has(banned),
        `banned alias "${banned}" must not appear in SKILL_ALIAS_ENTRIES`,
      );
    }
  });

  it("SKILL_ALIAS_MAP is derivable from SKILL_ALIAS_ENTRIES", () => {
    const expected = Object.fromEntries(
      SKILL_ALIAS_ENTRIES.map((e) => [e.alias, e.canonical]),
    );
    assert.deepStrictEqual(SKILL_ALIAS_MAP, expected);
  });

  it("all entries have valid mode values", () => {
    const VALID_MODES: readonly AliasMode[] = ["strict", "short-allow", "phrase"];
    for (const entry of SKILL_ALIAS_ENTRIES) {
      assert.ok(
        VALID_MODES.includes(entry.mode),
        `alias "${entry.alias}" has invalid mode "${entry.mode}"`,
      );
    }
  });

  it("no duplicate aliases exist", () => {
    const seen = new Set<string>();
    for (const entry of SKILL_ALIAS_ENTRIES) {
      assert.ok(
        !seen.has(entry.alias),
        `duplicate alias "${entry.alias}" in SKILL_ALIAS_ENTRIES`,
      );
      seen.add(entry.alias);
    }
  });

  it("every canonical is non-empty and lowercase", () => {
    for (const entry of SKILL_ALIAS_ENTRIES) {
      assert.ok(entry.canonical.length > 0, `empty canonical for alias "${entry.alias}"`);
      assert.equal(
        entry.canonical,
        entry.canonical.toLowerCase(),
        `canonical "${entry.canonical}" for alias "${entry.alias}" must be lowercase`,
      );
    }
  });
});
