import { SKILL_PHRASES } from "./glossary";

const ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;

function escapeRe(s: string) {
  return s.replace(ESCAPE_REGEX, "\\$&");
}

/** Longest phrases first so “machine learning” wins over “learning”. */
const ORDERED_PHRASES = [...SKILL_PHRASES].sort(
  (a, b) => b.length - a.length,
);

const CANONICAL: Record<string, string> = {};
for (const p of ORDERED_PHRASES) {
  const key = p.toLowerCase();
  CANONICAL[key] = formatLabel(p);
}

function formatLabel(raw: string): string {
  const lower = raw.toLowerCase();
  const map: Record<string, string> = {
    cicd: "CI/CD",
    gcp: "GCP",
    aws: "AWS",
    sql: "SQL",
    nosql: "NoSQL",
    etl: "ETL",
    elt: "ELT",
    jwt: "JWT",
    sso: "SSO",
    iam: "IAM",
    vpc: "VPC",
    cdn: "CDN",
    dns: "DNS",
    sre: "SRE",
    nlp: "NLP",
    llm: "LLM",
    ui: "UI",
    ux: "UX",
    api: "API",
    ios: "iOS",
    http: "HTTP",
    https: "HTTPS",
    grpc: "gRPC",
    php: "PHP",
    vue: "Vue",
    dbt: "dbt",
  };
  if (map[lower]) return map[lower];
  return raw
    .split(/[\s/-]+/)
    .map((w) => {
      if (w.length <= 3 && w === w.toUpperCase()) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function normalizeText(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function extractSkillsFromText(text: string): string[] {
  const hay = ` ${normalizeText(text).toLowerCase()} `;
  const found = new Set<string>();
  for (const phrase of ORDERED_PHRASES) {
    const pl = phrase.toLowerCase();
    const re = new RegExp(
      `(?:^|\\s|[^a-z0-9+.#])${escapeRe(pl)}(?:$|\\s|[^a-z0-9+.#])`,
      "i",
    );
    if (re.test(hay)) {
      found.add(CANONICAL[pl] ?? formatLabel(phrase));
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

export function mergeUniqueSkills(lists: string[][]): string[] {
  const s = new Set<string>();
  for (const l of lists) for (const x of l) s.add(x);
  return [...s].sort((a, b) => a.localeCompare(b));
}
