/**
 * Enrichment: ordered scan — same keys/labels as legacy enrichment.service, plus v1 extension.
 * `canonical` is the stable id used in scoring / semantic map keys.
 */
export const ENRICHMENT_KEYWORDS: readonly {
  key: string;
  label: string;
  canonical: string;
}[] = [
  { key: "react", label: "React", canonical: "react" },
  { key: "node", label: "Node", canonical: "nodejs" },
  { key: "typescript", label: "TypeScript", canonical: "typescript" },
  { key: "javascript", label: "JavaScript", canonical: "javascript" },
  { key: "python", label: "Python", canonical: "python" },
  { key: "java", label: "Java", canonical: "java" },
  { key: "c#", label: "C#", canonical: "csharp" },
  { key: ".net", label: ".NET", canonical: "dotnet" },
  { key: "aws", label: "AWS", canonical: "aws" },
  { key: "docker", label: "Docker", canonical: "docker" },
  { key: "kubernetes", label: "Kubernetes", canonical: "kubernetes" },
  { key: "postgresql", label: "PostgreSQL", canonical: "postgresql" },
  { key: "mysql", label: "MySQL", canonical: "mysql" },
  { key: "mongodb", label: "MongoDB", canonical: "mongodb" },
  { key: "redis", label: "Redis", canonical: "redis" },
  { key: "graphql", label: "GraphQL", canonical: "graphql" },
  { key: "golang", label: "Go", canonical: "golang" },
  { key: "rust", label: "Rust", canonical: "rust" },
  { key: "next", label: "Next.js", canonical: "nextjs" },
  { key: "svelte", label: "Svelte", canonical: "svelte" },
  { key: "terraform", label: "Terraform", canonical: "terraform" },
  { key: "pulumi", label: "Pulumi", canonical: "pulumi" },
  { key: "gcp", label: "GCP", canonical: "gcp" },
  { key: "azure", label: "Azure", canonical: "azure" },
] as const;

/** Single-word / token aliases → canonical (lowercase keys). */
export const TOKEN_TO_CANONICAL: Readonly<Record<string, string>> = {
  postgres: "postgresql",
  pgsql: "postgresql",
  postgresql: "postgresql",
  "node.js": "nodejs",
  nodejs: "nodejs",
  node: "nodejs",
  "next.js": "nextjs",
  nextjs: "nextjs",
  next: "nextjs",
  reactjs: "react",
  react: "react",
  ts: "typescript",
  typescript: "typescript",
  js: "javascript",
  javascript: "javascript",
  py: "python",
  python: "python",
  java: "java",
  "c#": "csharp",
  csharp: "csharp",
  cs: "csharp",
  dotnet: "dotnet",
  ".net": "dotnet",
  golang: "golang",
  go: "golang",
  rust: "rust",
  svelte: "svelte",
  k8s: "kubernetes",
  kubernetes: "kubernetes",
  kuberenetes: "kubernetes",
  docker: "docker",
  mysql: "mysql",
  mongodb: "mongodb",
  mongo: "mongodb",
  redis: "redis",
  graphql: "graphql",
  gcp: "gcp",
  aws: "aws",
  azure: "azure",
  terraform: "terraform",
  pulumi: "pulumi",
  elasticsearch: "elasticsearch",
  opensearch: "opensearch",
  kafka: "kafka",
  rabbitmq: "rabbitmq",
  grpc: "grpc",
  nosql: "nosql",
  sql: "sql",
} as const;

/**
 * Longest-first for greedy phrase scan (lowercase, single internal spaces, punctuation stripped in lines).
 * Phrases that normalize to the same as multi-token paths should still be listed.
 */
const PHRASE_RAW: { phrase: string; canonical: string }[] = [
  { phrase: "amazon web services", canonical: "aws" },
  { phrase: "google cloud platform", canonical: "gcp" },
  { phrase: "google cloud", canonical: "gcp" },
  { phrase: "node js", canonical: "nodejs" },
  { phrase: "node.js", canonical: "nodejs" },
  { phrase: "next js", canonical: "nextjs" },
  { phrase: "next.js", canonical: "nextjs" },
  { phrase: "c sharp", canonical: "csharp" },
  { phrase: "c #", canonical: "csharp" },
];
/** Longest first for non-overlapping phrase scan. */
export const PHRASE_TO_CANONICAL: readonly { phrase: string; canonical: string }[] = [...PHRASE_RAW].sort(
  (a, b) => b.phrase.length - a.phrase.length,
);

function collectCanonicals(): string[] {
  const s = new Set<string>();
  for (const e of ENRICHMENT_KEYWORDS) s.add(e.canonical);
  for (const c of Object.values(TOKEN_TO_CANONICAL)) s.add(c);
  for (const p of PHRASE_TO_CANONICAL) s.add(p.canonical);
  return [...s].sort();
}

export const CANONICAL_IDS: readonly string[] = collectCanonicals();

export const CANONICAL_SET: ReadonlySet<string> = new Set(CANONICAL_IDS);

function buildAliasStringsByCanonical(): Readonly<Record<string, string[]>> {
  const m = new Map<string, Set<string>>();

  const add = (canonical: string, variant: string) => {
    const v = variant.toLowerCase().trim();
    if (v.length < 2) return;
    if (v === canonical) return;
    if (!m.has(canonical)) m.set(canonical, new Set());
    m.get(canonical)!.add(v);
  };

  for (const [token, can] of Object.entries(TOKEN_TO_CANONICAL)) {
    if (can !== token) add(can, token);
  }

  for (const { phrase, canonical } of PHRASE_TO_CANONICAL) {
    const p = phrase.toLowerCase().trim();
    if (p !== canonical) add(canonical, p);
  }

  for (const e of ENRICHMENT_KEYWORDS) {
    if (e.key.toLowerCase() !== e.canonical) add(e.canonical, e.key);
  }

  const out: Record<string, string[]> = {};
  for (const [c, set] of m) {
    out[c] = [...set].sort((a, b) => b.length - a.length);
  }
  return out;
}

/** Match resume text: try canonical first, then these (longer first, already sorted). */
export const ALIASES_BY_CANONICAL: Readonly<Record<string, string[]>> = buildAliasStringsByCanonical();

export function dictionaryFingerprintPayload(): string {
  return JSON.stringify({
    enrichment: ENRICHMENT_KEYWORDS,
    token: TOKEN_TO_CANONICAL,
    phrase: PHRASE_TO_CANONICAL,
  });
}
