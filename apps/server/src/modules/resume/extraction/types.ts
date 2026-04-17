export type ConfidenceLevel = "high" | "medium" | "low";

export type ResumeSections = {
  summary: string[];
  experience: string[];
  education: string[];
  skills: string[];
  projects: string[];
  certifications: string[];
  languages: string[];
  other: string[];
};

export type EducationEntry = {
  university?: string;
  degree?: string;
  course?: string;
  startDate?: string;
  endDate?: string;
  cgpa?: string;
};

export type ExperienceEntry = {
  role?: string;
  company?: string;
  startDate?: string;
  endDate?: string;
  durationYears?: number;
  bullets: string[];
};

export type ProjectEntry = {
  title?: string;
  bullets: string[];
};

export type ResumeStructured = {
  personal: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    city?: string;
    country?: string;
    linkedin?: string;
    github?: string;
    portfolio?: string;
  };
  summary?: string;
  skills?: string[];
  languages?: string[];
  certifications?: string[];
  education?: EducationEntry[];
  experience?: ExperienceEntry[];
  projects?: ProjectEntry[];
  meta: {
    confidence: Record<string, ConfidenceLevel>;
    extractionVersion: string;
    socialSignals?: {
      linkedinLabelSeen: boolean;
      githubLabelSeen: boolean;
      portfolioLabelSeen: boolean;
      linkedinUrlFound: boolean;
      githubUrlFound: boolean;
      portfolioUrlFound: boolean;
    };
  };
};
