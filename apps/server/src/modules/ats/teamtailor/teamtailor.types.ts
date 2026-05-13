export interface TeamtailorJobAttributes {
  title?: string;
  body?: string;
  location?: string;
  external_application_url?: string;
  created_at?: string;
  /** When present, closer to public publish than `created_at`. */
  published_at?: string;
  start_date?: string;
  salary?: import("../../../utils/jobDetailHtml.js").JsonLdSalary | null;
}

export interface TeamtailorJob {
  id?: string;
  type?: string;
  attributes?: TeamtailorJobAttributes;
}

export interface TeamtailorApiResponse {
  data?: TeamtailorJob[];
}

