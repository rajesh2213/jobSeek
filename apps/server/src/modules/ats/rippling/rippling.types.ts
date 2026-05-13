export interface RipplingRawJob {
  title?: string;
  sourceUrl?: string;
  location?: string;
  description?: string;
  postedAt?: string;
  salary?: import("../../../utils/jobDetailHtml.js").JsonLdSalary | null;
}

