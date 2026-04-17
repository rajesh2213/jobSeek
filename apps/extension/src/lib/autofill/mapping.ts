import type { FieldConfidence, FieldType, FieldValueSource } from "./types";

export interface ProfileMappingInput {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  currentTitle?: string;
  currentCompany?: string;
  yearsOfExperience?: number;
  workAuthorization?: string;
  salaryExpectation?: string;
  availableFrom?: string;
}

export interface MappingResult {
  value: string | null;
  confidence: FieldConfidence;
  source: FieldValueSource;
}

export function mapDeterministicValue(fieldType: FieldType, profile: ProfileMappingInput): MappingResult {
  const fullName = [profile.firstName?.trim(), profile.lastName?.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();
  const location = [profile.city?.trim(), profile.country?.trim()].filter(Boolean).join(", ").trim();
  const map: Record<string, string | number | undefined> = {
    fullName: profile.fullName || fullName || undefined,
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    phone: profile.phone,
    location: location || profile.city,
    address: profile.address,
    city: profile.city,
    country: profile.country,
    linkedin: profile.linkedinUrl,
    github: profile.githubUrl,
    portfolio: profile.portfolioUrl,
    website: profile.portfolioUrl,
    currentTitle: profile.currentTitle,
    currentCompany: profile.currentCompany,
    yearsExperience: profile.yearsOfExperience,
    salary: profile.salaryExpectation,
    availability: profile.availableFrom,
    workAuthorization: profile.workAuthorization,
  };
  const raw = map[fieldType];
  const value = raw == null ? null : String(raw).trim();
  if (!value) return { value: null, confidence: "low", source: "fallback" };

  if (fieldType === "phone" && value.includes("@")) return { value: null, confidence: "low", source: "fallback" };
  if (fieldType === "email" && !value.includes("@")) return { value: null, confidence: "low", source: "fallback" };

  return { value, confidence: "high", source: "mapping" };
}

