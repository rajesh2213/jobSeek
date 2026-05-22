import type { JobFilters } from "../../lib/slug-parser";

interface FaqEntry {
  question: string;
  answer: string;
}

function toTitle(s: string): string {
  return s
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

const LOCATION_DISPLAY: Record<string, string> = {
  US: "the United States", IN: "India", GB: "the United Kingdom", CA: "Canada",
  DE: "Germany", AU: "Australia", FR: "France", NL: "the Netherlands",
  ES: "Spain", IT: "Italy", SE: "Sweden", PL: "Poland", SG: "Singapore",
  AE: "the UAE", JP: "Japan", BR: "Brazil", MX: "Mexico", ZA: "South Africa",
};

/**
 * Deterministic FAQ entries based on the page's filter context.
 * Returns 3-4 context-specific questions, plus one generic platform question.
 * No AI generation, no external fetches — pure template interpolation.
 */
function buildFaqEntries(filters?: JobFilters, total?: number): FaqEntry[] {
  const role = filters?.role?.trim();
  const category = filters?.category?.trim();
  const skill = filters?.skills?.[0]?.trim();
  const isRemote =
    filters?.workType === "remote" || filters?.isRemote === true;
  const country = filters?.country?.trim()?.toUpperCase();
  const loc = country ? (LOCATION_DISPLAY[country] ?? country) : null;
  const countStr = typeof total === "number" && total > 0 ? total.toLocaleString() : null;
  const entries: FaqEntry[] = [];

  if (role) {
    const t = toTitle(role);
    entries.push({
      question: `How many ${t} jobs are available${isRemote ? " remotely" : loc ? ` in ${loc}` : ""}?`,
      answer: countStr
        ? `There are currently ${countStr} ${t.toLowerCase()} positions${isRemote ? " available remotely" : loc ? ` in ${loc}` : ""} on JobLoom, refreshed daily from company career pages.`
        : `${t} listings are refreshed daily on JobLoom as companies publish new openings${isRemote ? " for remote work" : loc ? ` in ${loc}` : ""}.`,
    });
    entries.push({
      question: `What skills are typically required for ${t} roles?`,
      answer: `${t} roles commonly require a mix of technical and domain skills that vary by seniority and industry. Browse individual listings on this page to see the specific requirements for each opening.`,
    });
  }

  if (skill && !role && !category) {
    const t = toTitle(skill);
    entries.push({
      question: `How many ${t} jobs are available${isRemote ? " remotely" : loc ? ` in ${loc}` : ""}?`,
      answer: countStr
        ? `There are ${countStr} active listings requiring ${t.toLowerCase()} on JobLoom, aggregated from company career pages and refreshed daily.`
        : `${t} roles are listed as companies publish new openings on JobLoom.`,
    });
    entries.push({
      question: `What kinds of roles use ${t}?`,
      answer: `Browse this page to see employers hiring for ${t.toLowerCase()} across engineering, data, product, and other teams — with filters for location and work type.`,
    });
  }

  if (category) {
    const t = toTitle(category);
    entries.push({
      question: `What types of roles fall under ${t}?`,
      answer: `The ${t.toLowerCase()} category includes a range of specialized roles. Browse this page to discover the specific titles and seniority levels companies are currently hiring for.`,
    });
    if (countStr) {
      entries.push({
        question: `How many ${t.toLowerCase()} jobs are listed?`,
        answer: `JobLoom currently lists ${countStr} ${t.toLowerCase()} positions${isRemote ? " available remotely" : loc ? ` in ${loc}` : ""}, sourced directly from company career sites and refreshed daily.`,
      });
    }
  }

  if (isRemote && !role && !category) {
    entries.push({
      question: "How are remote jobs verified?",
      answer: "Remote listings on JobLoom are sourced directly from company career pages. Each listing retains the original work-type designation published by the employer.",
    });
  }

  if (loc && !role && !category) {
    entries.push({
      question: `What types of jobs are available in ${loc}?`,
      answer: countStr
        ? `There are ${countStr} jobs currently listed in ${loc} across categories including engineering, data, product, and more — refreshed daily.`
        : `JobLoom aggregates jobs in ${loc} across engineering, data, product, design, and other categories from company career pages.`,
    });
  }

  entries.push({
    question: "How often are jobs updated?",
    answer: "We refresh listings continuously as sources publish new roles. Use posted-date filters to focus on recent openings.",
  });

  entries.push({
    question: "How do free browsing limits work?",
    answer: "Free includes a shared daily budget for job list rows across job search and company pages. After the daily budget is used, page 1 shows only a short preview. Upgrade to Pro for unlimited browsing.",
  });

  return entries.slice(0, 4);
}

/**
 * Build FAQ JSON-LD (FAQPage schema) from the same deterministic entries.
 */
export function buildFaqJsonLd(filters?: JobFilters, total?: number): Record<string, unknown> | null {
  const entries = buildFaqEntries(filters, total);
  if (entries.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((e) => ({
      "@type": "Question",
      name: e.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: e.answer,
      },
    })),
  };
}

/**
 * FAQ block for job discovery — rendered below the job list.
 * When filters are provided, generates context-specific questions.
 * Falls back to generic platform FAQs when no context is available.
 */
export function JobsListingFaq(props?: { filters?: JobFilters; total?: number }) {
  const entries = buildFaqEntries(props?.filters, props?.total);
  if (entries.length === 0) return null;
  return (
    <section className="text-left">
      <h2 className="text-xs font-bold uppercase tracking-wider text-ink/45">Common questions</h2>
      <dl className="mt-4 space-y-4 text-sm leading-relaxed text-ink/75">
        {entries.map((entry) => (
          <div key={entry.question}>
            <dt className="font-semibold text-ink">{entry.question}</dt>
            <dd className="mt-1">{entry.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
