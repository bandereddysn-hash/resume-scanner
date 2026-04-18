import type { ScanResult } from "./analyzer";

/** 0–100 fit score for ranking (offline heuristic, same rules as single scan). */
export function scoreScanResult(r: ScanResult): number {
  const mandatoryRows = r.rows.filter((x) => x.jdMandatory);
  const mandatoryTotal = mandatoryRows.length;
  const mandatoryOk = mandatoryRows.filter(
    (x) => x.inResume && x.meetsMandatoryExperience !== false,
  ).length;

  const jdSkillCount = r.jdSkills.length || 1;
  const matchedJdSkills = r.rows.filter((x) => x.inJd && x.inResume).length;

  let score = 0;
  if (r.verdict === "shortlist") score += 42;
  else if (r.verdict === "not_enough_experience") score += 22;
  else score += 5;

  if (mandatoryTotal > 0) {
    score += 40 * (mandatoryOk / mandatoryTotal);
  } else {
    score += 25;
  }

  score += 18 * Math.min(1, matchedJdSkills / jdSkillCount);

  return Math.round(Math.min(100, Math.max(0, score)));
}

export function verdictShortLabel(v: ScanResult["verdict"]): string {
  if (v === "shortlist") return "Strong fit";
  if (v === "not_enough_experience") return "Weak on years";
  return "Missing must-haves";
}
