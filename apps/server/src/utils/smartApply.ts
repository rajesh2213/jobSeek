import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type SmartApplyTone = "professional" | "friendly" | "formal" | "casual";
export type SmartApplyLength = "short" | "medium" | "long";

export interface SmartApplyPreferencesShape {
  tone?: SmartApplyTone;
  length?: SmartApplyLength;
  firstPerson?: boolean;
}

const MAX_RESUME_EXCERPT_CHARS = 12_000;

export interface AnswerRequest {
  questions: Array<{ id: string; question: string; charLimit?: number }>;
  jobTitle: string;
  companyName: string;
  profileContext: string; // from buildPromptContext()
  resumeExcerpt?: string;
  preferences?: SmartApplyPreferencesShape | null;
}

export interface AnswerResult {
  answers: Array<{ id: string; answer: string }>;
  tokensUsed: number;
  answerMeta?: Array<{ id: string; source: "llm"; confidence: "high" | "medium" | "low" }>;
}

export type QuestionIntent = {
  topic: string;
  type: "experience" | "motivation" | "behavioral" | "factual" | "unknown";
  keywords: string[];
};

function tokenize(v: string): string[] {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

export function extractIntent(question: string): QuestionIntent {
  const q = question.toLowerCase();
  const keywords = Array.from(new Set(tokenize(question))).slice(0, 8);
  const type: QuestionIntent["type"] = /\b(implemented|built|designed|experience|project)\b/.test(q)
    ? "experience"
    : /\b(why|motivation|interested|join)\b/.test(q)
      ? "motivation"
      : /\b(challenge|conflict|situation|tell us about)\b/.test(q)
        ? "behavioral"
        : /\b(yes|no|how many|years|salary|available)\b/.test(q)
          ? "factual"
          : "unknown";
  return { topic: keywords[0] ?? "general", type, keywords };
}

function buildRelevantResumeContext(resumeExcerpt: string | undefined, intents: QuestionIntent[]): string {
  if (!resumeExcerpt?.trim()) return "";
  const lines = resumeExcerpt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (!lines.length) return "";

  const keywords = new Set(intents.flatMap((i) => i.keywords));
  const picked: string[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    const hit = Array.from(keywords).some((k) => lower.includes(k));
    if (hit) picked.push(line);
    if (picked.length >= 45) break;
  }

  if (!picked.length) return lines.slice(0, 30).join("\n");
  return picked.join("\n");
}

function humanizeAnswer(answer: string, maxChars?: number): string {
  let out = answer.trim();
  out = out.replace(/\b(as an ai|as a language model)\b/gi, "");
  out = out.replace(/\bI would like to\b/gi, "I");
  out = out.replace(/\bI am excited to\b/gi, "I");
  out = out.replace(/\s+/g, " ").trim();
  if (maxChars && maxChars > 0 && out.length > maxChars) {
    out = out.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
  }
  return out;
}

function llmConfidence(answer: string): "high" | "medium" | "low" {
  if (!answer.trim()) return "low";
  if (answer.length < 20) return "low";
  if (answer.length < 70) return "medium";
  return "high";
}

function buildAnswerStyleBlock(prefs: SmartApplyPreferencesShape | null | undefined): string {
  const tone = prefs?.tone ?? "professional";
  const length = prefs?.length ?? "medium";
  const firstPerson = prefs?.firstPerson !== false;
  const lengthHint =
    length === "short"
      ? "Keep each answer brief (about 2–4 sentences unless a char limit requires shorter)."
      : length === "long"
        ? "Answers may be detailed (up to 150 words unless a stricter character limit applies)."
        : "Moderate length (roughly one short paragraph unless a character limit says otherwise).";
  return `Answer style:
- Tone: ${tone}
- ${lengthHint}
- ${firstPerson ? "Use first person (I, my)." : "Use third person where appropriate."}`;
}

export async function generateApplyAnswers(req: AnswerRequest): Promise<AnswerResult> {
  const intents = req.questions.map((q) => extractIntent(q.question));
  const intentBlock = req.questions
    .map((q, i) => {
      const intent = intents[i];
      return `Q${i + 1} [id:${q.id}] intent: topic=${intent?.topic ?? "general"}, type=${intent?.type ?? "unknown"}, keywords=${(intent?.keywords ?? []).join(", ")}`;
    })
    .join("\n");
  const questionsText = req.questions
    .map(
      (q, i) =>
        `Q${i + 1} [id:${q.id}]${q.charLimit ? ` (max ${q.charLimit} chars)` : ""}: ${q.question}`,
    )
    .join("\n");

  const styleBlock = buildAnswerStyleBlock(req.preferences ?? null);
  const focusedResumeContext = buildRelevantResumeContext(req.resumeExcerpt, intents);
  const resumeBlock =
    focusedResumeContext.trim().length > 0
      ? `\nResume (filtered excerpt for grounding):\n${focusedResumeContext.trim().slice(0, MAX_RESUME_EXCERPT_CHARS)}\n`
      : "";

  const prompt = `You are filling out a job application form.

Job: ${req.jobTitle} at ${req.companyName}

${styleBlock}

${req.profileContext}
${resumeBlock}
Intent hints:
${intentBlock}

Answer each question below. Rules:
- Follow the answer style above
- Under 150 words per answer unless a character limit says otherwise
- For yes/no questions: answer only "Yes" or "No"
- For numeric questions: answer only the number
- Reference real experience where relevant; prefer facts from the profile and resume excerpt
- Never fabricate specific metrics not in the profile or resume

Questions:
${questionsText}

Respond in valid JSON only, no markdown:
{"answers": [{"id": "the_id_value", "answer": "answer text"}, ...]}`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const clean = text.replace(/```json|```/g, "").trim();

  let parsed: { answers: Array<{ id: string; answer: string }> };
  try {
    parsed = JSON.parse(clean) as { answers: Array<{ id: string; answer: string }> };
  } catch {
    parsed = { answers: [] };
  }

  const byId = new Map(req.questions.map((q) => [q.id, q]));
  const normalized = (parsed.answers ?? []).map((a) => {
    const q = byId.get(a.id);
    return {
      id: a.id,
      answer: humanizeAnswer(a.answer ?? "", q?.charLimit),
    };
  });

  return {
    answers: normalized,
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    answerMeta: normalized.map((a) => ({
      id: a.id,
      source: "llm",
      confidence: llmConfidence(a.answer),
    })),
  };
}

/** Optional LLM pass for POST /account/resume/extract-profile — merge empty fields only on caller side. */
export interface ExtractedProfileFields {
  firstName?: string;
  lastName?: string;
  phone?: string;
  city?: string;
  country?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  currentTitle?: string;
  currentCompany?: string;
  yearsOfExperience?: number;
  professionalSummary?: string;
  languages?: string;
  certifications?: string;
  highestEducation?: string;
}

export async function extractApplyProfileWithLLM(resumeText: string): Promise<ExtractedProfileFields | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;

  const clipped = resumeText.slice(0, 24_000);
  const prompt = `Extract job-relevant candidate facts from the resume text below. Return JSON only, no markdown.
Use null for any field you cannot support from the text.
Fields:
- firstName, lastName, phone, city, country (strings)
- linkedinUrl, githubUrl, portfolioUrl (full https URLs; include these if the resume shows linkedin.com, github.com, or a labeled personal site URL, even without "https://" in the source)
- currentTitle, currentCompany
- yearsOfExperience (integer years total, estimate only if clearly stated)
- professionalSummary (2-4 sentences, first person, no fabrication)
- languages (comma-separated)
- certifications (comma-separated or short list)
- highestEducation (one line, e.g. degree and school)

Resume:
${clipped}

Respond: {"firstName": null, ...}`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(clean) as ExtractedProfileFields;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
