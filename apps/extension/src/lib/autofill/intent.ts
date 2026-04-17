export type QuestionIntentType = "experience" | "motivation" | "behavioral" | "factual" | "unknown";

export interface QuestionIntent {
  topic: string;
  type: QuestionIntentType;
  keywords: string[];
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "your",
  "you",
  "this",
  "that",
  "what",
  "when",
  "where",
  "how",
  "have",
  "did",
  "are",
  "was",
  "were",
  "from",
  "into",
  "about",
  "please",
]);

function tokens(v: string): string[] {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

export function extractIntent(question: string): QuestionIntent {
  const q = question.toLowerCase();
  const kws = Array.from(new Set(tokens(question))).slice(0, 8);
  const type: QuestionIntentType = /\b(led|built|implemented|experience|worked|project)\b/.test(q)
    ? "experience"
    : /\b(why|motivation|interested|join)\b/.test(q)
      ? "motivation"
      : /\b(tell me about|conflict|challenge|situation)\b/.test(q)
        ? "behavioral"
        : /\b(yes|no|how many|years|salary|available)\b/.test(q)
          ? "factual"
          : "unknown";
  return {
    topic: kws[0] ?? "general",
    type,
    keywords: kws,
  };
}

