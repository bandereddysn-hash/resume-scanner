import type { ScanResult } from "./analyzer";

const VERDICTS = new Set<ScanResult["verdict"]>([
  "shortlist",
  "not_enough_experience",
  "missing_mandatory_skills",
]);

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function asNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() === "") return null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** Coerce LLM JSON into ScanResult; fills gaps so the UI never crashes. */
export function coerceScanResult(raw: unknown): ScanResult {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const jdSkillsRaw = Array.isArray(o.jdSkills) ? o.jdSkills : [];
  const jdSkills = jdSkillsRaw.map((x) => {
    const r = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    return {
      skill: asStr(r.skill, "Unknown"),
      mandatory: asBool(r.mandatory, false),
      minYears: asNumOrNull(r.minYears),
    };
  });

  const resumeSkills = Array.isArray(o.resumeSkills)
    ? o.resumeSkills.map((s) => asStr(s)).filter(Boolean)
    : [];

  const rowsRaw = Array.isArray(o.rows) ? o.rows : [];
  const rows = rowsRaw.map((x) => {
    const r = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    return {
      skill: asStr(r.skill, "Unknown"),
      inJd: asBool(r.inJd, false),
      inResume: asBool(r.inResume, false),
      jdMandatory: asBool(r.jdMandatory, false),
      jdMinYears: asNumOrNull(r.jdMinYears),
      resumeYears: asNumOrNull(r.resumeYears),
      meetsMandatoryExperience:
        typeof r.meetsMandatoryExperience === "boolean"
          ? r.meetsMandatoryExperience
          : null,
      notes: asStr(r.notes, ""),
    };
  });

  const verdictRaw = o.verdict;
  const verdict = VERDICTS.has(verdictRaw as ScanResult["verdict"])
    ? (verdictRaw as ScanResult["verdict"])
    : "shortlist";

  const summary = Array.isArray(o.summary)
    ? o.summary.map((s) => asStr(s)).filter(Boolean)
    : ["Model returned no summary."];

  return { jdSkills, resumeSkills, rows, verdict, summary };
}

export type GroqScanResponse =
  | { ok: true; scan: ScanResult; model?: string }
  | {
      ok: false;
      status: number;
      error: string;
      /** e.g. `missing_api_key` from the Netlify function */
      code?: string;
      details?: unknown;
    };

function scanUrl(): string {
  const base = (import.meta.env.VITE_FUNCTIONS_BASE_URL as string | undefined)?.replace(
    /\/$/,
    "",
  ) ?? "";
  return `${base}/.netlify/functions/resume-scan`;
}

export async function scanWithGroq(jd: string, resume: string): Promise<GroqScanResponse> {
  let res: Response;
  try {
    res = await fetch(scanUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jd, resume }),
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : String(e),
      code: "network_error",
    };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return {
      ok: false,
      status: res.status,
      error: "Invalid response from scan service",
    };
  }

  if (!res.ok) {
    const d = data as Record<string, unknown>;
    const errField = d.error;
    return {
      ok: false,
      status: res.status,
      error: asStr(d.message, asStr(d.error, `HTTP ${res.status}`)),
      code: typeof errField === "string" ? errField : undefined,
      details: data,
    };
  }

  const d = data as Record<string, unknown>;
  if (!d.scan) {
    return { ok: false, status: 502, error: "Missing scan payload", details: data };
  }

  return {
    ok: true,
    scan: coerceScanResult(d.scan),
    model: typeof d.model === "string" ? d.model : undefined,
  };
}
