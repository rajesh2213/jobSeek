export interface TeamtailorJobAttributes {
  title?: string;
  body?: string;
  location?: string;
  external_application_url?: string;
  created_at?: string;
}

export interface TeamtailorJob {
  id?: string;
  type?: string;
  attributes?: TeamtailorJobAttributes;
}

export interface TeamtailorApiResponse {
  data?: TeamtailorJob[];
}

