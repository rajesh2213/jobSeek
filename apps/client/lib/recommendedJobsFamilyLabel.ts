import type { RoleFamily } from "./resumeFitTitle";

const FAMILY_LABELS: Partial<Record<RoleFamily, string>> = {
  "software.engineering": "software engineering",
  "engineering.backend": "backend engineering",
  "engineering.frontend": "frontend engineering",
  "engineering.devops": "DevOps",
  "engineering.data": "data engineering",
  "engineering.ml": "machine learning",
  "technical.operations": "technical operations",
  "mechanical.engineering": "mechanical engineering",
  product: "product management",
  design: "design",
  sales: "sales",
  customer_success: "customer success",
  marketing: "marketing",
  recruiting: "recruiting",
  hr: "human resources",
  finance: "finance",
  operations: "operations",
  "healthcare.clinical": "healthcare",
  "healthcare.admin": "healthcare administration",
  legal: "legal",
  research: "research",
  other: "professional",
};

export function recommendedJobsSubtitle(candidateFamily: RoleFamily): string {
  const label = FAMILY_LABELS[candidateFamily] ?? "professional";
  return `Based on your ${label} experience`;
}
