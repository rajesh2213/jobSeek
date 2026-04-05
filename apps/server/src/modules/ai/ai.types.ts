/** Structured output from the job-description parser service (matches FastAPI /parse). */
export interface ParsedJobDescriptionAI {
  position: string[];
  responsibility: string[];
  requirement: string[];
  experience: string[];
  benefit: string[];
  contact: string[];
  other: string[];
}

export function emptyParsedJobDescription(): ParsedJobDescriptionAI {
  return {
    position: [],
    responsibility: [],
    requirement: [],
    experience: [],
    benefit: [],
    contact: [],
    other: [],
  };
}
