import { extractSkillsFromText } from "./skills";
import { skillYearsFromResume } from "./workHistory";

export type JdSkillMeta = {
  skill: string;
  mandatory: boolean;
  minYears: number | null;
};

export type SkillRow = {
  skill: string;
  inJd: boolean;
  inResume: boolean;
  jdMandatory: boolean;
  jdMinYears: number | null;
  resumeYears: number | null;
  meetsMandatoryExperience: boolean | null;
  notes: string;
};

export type ScanResult = {
  jdSkills: JdSkillMeta[];
  resumeSkills: string[];
  rows: SkillRow[];
  verdict: "shortlist" | "not_enough_experience" | "missing_mandatory_skills";
  summary: string[];
};

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sentenceLooksMandatory(s: string): boolean {
  return /\b(must|mandatory|required|shall|minimum|at least)\b/i.test(s);
}

function extractMinYearsNear(text: string): number | null {
  const m = text.match(/\b(\d{1,2})\+?\s*(?:years?|yrs?)\b/i);
  if (m) return Number(m[1]);
  return null;
}

function enrichJdSkills(jdText: string, jdSkills: string[]): JdSkillMeta[] {
  const sentences = splitSentences(jdText);
  const lowerJd = jdText.toLowerCase();

  const sectionMandatory =
    /\b(requirements|qualifications|must[- ]have|minimum qualifications)\b/i;
  let inMandatorySection = false;
  const lines = jdText.split(/\n+/);
  const mandatoryLines = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (sectionMandatory.test(lines[i])) inMandatorySection = true;
    if (inMandatorySection && /^(\s*[-*•]|\s*\d+[\).])/.test(lines[i])) {
      mandatoryLines.add(i);
    }
  }

  return jdSkills.map((skill) => {
    const sl = skill.toLowerCase();
    let mandatory = false;
    let minYears: number | null = null;

    for (const sent of sentences) {
      if (!sent.toLowerCase().includes(sl)) continue;
      if (sentenceLooksMandatory(sent)) mandatory = true;
      const y = extractMinYearsNear(sent);
      if (y !== null) minYears = y;
    }

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(sl)) continue;
      if (mandatoryLines.has(i)) mandatory = true;
    }

    if (/\b(key requirements|must have)\b/i.test(lowerJd) && !mandatory) {
      /** Soft boost: skills repeated in title area — keep conservative */
    }

    return { skill, mandatory, minYears };
  });
}

function buildSkillRegex(skill: string): RegExp {
  const esc = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = esc.split(/\s+/).filter(Boolean);
  const body = parts.join("\\s+");
  return new RegExp(`(?:^|[^a-z0-9])${body}(?:$|[^a-z0-9])`, "i");
}

export function analyzeResumeAgainstJd(
  jdText: string,
  resumeText: string,
): ScanResult {
  const jdSkillsList = extractSkillsFromText(jdText);
  const resumeSkillsList = extractSkillsFromText(resumeText);
  const jdMeta = enrichJdSkills(jdText, jdSkillsList);

  const skillMatchers = new Map<string, RegExp>();
  for (const s of new Set([...jdSkillsList, ...resumeSkillsList])) {
    skillMatchers.set(s, buildSkillRegex(s));
  }

  const yearsMap = skillYearsFromResume(resumeText, skillMatchers);

  const jdSet = new Set(jdSkillsList);
  const resumeSet = new Set(resumeSkillsList);
  const allSkills = [...new Set([...jdSkillsList, ...resumeSkillsList])].sort(
    (a, b) => a.localeCompare(b),
  );

  const metaBySkill = new Map(jdMeta.map((m) => [m.skill, m]));

  const rows: SkillRow[] = allSkills.map((skill) => {
    const inJd = jdSet.has(skill);
    const inResume = resumeSet.has(skill);
    const meta = metaBySkill.get(skill);
    const jdMandatory = meta?.mandatory ?? false;
    const jdMinYears = meta?.minYears ?? null;
    const resumeYears = inResume ? (yearsMap.get(skill) ?? null) : null;

    let meetsMandatoryExperience: boolean | null = null;
    let notes = "";

    if (!inJd) {
      notes = "Extra on resume; not highlighted in detected JD skills.";
    } else if (!inResume) {
      notes = "Not found in resume text.";
      meetsMandatoryExperience = false;
    } else if (jdMandatory && jdMinYears !== null && resumeYears !== null) {
      meetsMandatoryExperience = resumeYears + 1e-6 >= jdMinYears;
      notes = meetsMandatoryExperience
        ? `Resume shows ~${resumeYears}y in dated roles mentioning this skill vs JD hint of ${jdMinYears}+y.`
        : `JD asks ~${jdMinYears}+y; dated overlap shows ~${resumeYears}y for this skill.`;
    } else if (jdMandatory && jdMinYears !== null && resumeYears === null) {
      meetsMandatoryExperience = false;
      notes = "Mandatory with year hint, but no dated overlap found.";
    } else if (inResume && resumeYears !== null) {
      meetsMandatoryExperience = true;
      notes = `Approximate overlap from employment dates: ~${resumeYears}y.`;
      if (jdMinYears !== null) {
        meetsMandatoryExperience = resumeYears + 1e-6 >= jdMinYears;
        notes = meetsMandatoryExperience
          ? notes
          : `JD hints ${jdMinYears}+y; overlap ~${resumeYears}y.`;
      }
    } else {
      notes = "Skill present; year overlap unclear (check resume dates).";
      meetsMandatoryExperience = jdMinYears === null ? true : null;
    }

    return {
      skill,
      inJd,
      inResume,
      jdMandatory,
      jdMinYears,
      resumeYears,
      meetsMandatoryExperience,
      notes,
    };
  });

  const summary: string[] = [];
  const missingMandatorySkills = rows.filter(
    (r) => r.jdMandatory && !r.inResume,
  );
  const weakMandatory = rows.filter(
    (r) =>
      r.jdMandatory &&
      r.inResume &&
      r.jdMinYears !== null &&
      r.meetsMandatoryExperience === false,
  );

  let verdict: ScanResult["verdict"] = "shortlist";
  if (missingMandatorySkills.length > 0) {
    verdict = "missing_mandatory_skills";
    summary.push(
      `Missing mandatory-style skills: ${missingMandatorySkills.map((r) => r.skill).join(", ")}`,
    );
  } else if (weakMandatory.length > 0) {
    verdict = "not_enough_experience";
    summary.push(
      `Mandatory skills with weaker dated overlap than JD hints: ${weakMandatory.map((r) => r.skill).join(", ")}`,
    );
  } else {
    summary.push(
      "All detected mandatory skills appear on the resume; year checks passed where JD stated a minimum.",
    );
  }

  if (jdSkillsList.length === 0) {
    summary.push(
      "No glossary skills detected in the JD. Paste clearer tool names or extend the glossary.",
    );
  }

  return {
    jdSkills: jdMeta,
    resumeSkills: resumeSkillsList,
    rows,
    verdict,
    summary,
  };
}
