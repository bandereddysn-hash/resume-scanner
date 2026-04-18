export type JobSpan = {
  raw: string;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  /** Inclusive fractional years for display */
  years: number;
  text: string;
};

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function monthFromToken(tok: string): number | null {
  const t = tok.trim().toLowerCase().replace(/\./g, "");
  if (!t) return null;
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= 12 ? n : null;
  }
  const key3 = t.slice(0, 3);
  const fromPrefix: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  return fromPrefix[key3] ?? MONTHS[t] ?? null;
}

function isPresent(tok: string): boolean {
  const t = tok.trim().toLowerCase();
  return (
    t === "present" ||
    t === "current" ||
    t === "now" ||
    t === "till date" ||
    t === "till-date"
  );
}

const RANGE_RE =
  /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|\d{4})\s*[-–—]\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|\d{4}|present|current|now)\b/gi;

function parseSide(side: string): { y: number; m: number } | null {
  const s = side.trim();
  const present = isPresent(s);
  if (present) {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  }
  const mdy = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (mdy) return { y: Number(mdy[2]), m: Number(mdy[1]) };
  const my = s.match(
    /^((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*)\.?\s+(\d{4})$/i,
  );
  if (my) {
    const mo = monthFromToken(my[1]);
    const y = Number(my[2]);
    if (mo && y) return { y, m: mo };
  }
  const yOnly = s.match(/^(\d{4})$/);
  if (yOnly) return { y: Number(yOnly[1]), m: 1 };
  return null;
}

function monthsBetween(
  a: { y: number; m: number },
  b: { y: number; m: number },
): number {
  return (b.y - a.y) * 12 + (b.m - a.m) + 1;
}

export function parseJobSpans(resumeText: string): JobSpan[] {
  const text = resumeText.replace(/\r\n/g, "\n");
  const spans: JobSpan[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(RANGE_RE);
  while ((m = re.exec(text)) !== null) {
    let left = parseSide(m[1]);
    let right = parseSide(m[2]);
    if (!left || !right) continue;
    let totalMonths = monthsBetween(left, right);
    if (totalMonths <= 0) {
      const tmp = left;
      left = right;
      right = tmp;
      totalMonths = monthsBetween(left, right);
    }
    if (totalMonths <= 0 || totalMonths > 600) continue;
    const years = Math.round((totalMonths / 12) * 10) / 10;
    const start = Math.max(0, m.index - 120);
    const end = Math.min(text.length, m.index + m[0].length + 800);
    const chunk = text.slice(start, end);
    spans.push({
      raw: m[0],
      startYear: left.y,
      startMonth: left.m,
      endYear: right.y,
      endMonth: right.m,
      years,
      text: chunk,
    });
  }
  return spans;
}

export function skillYearsFromResume(
  resumeText: string,
  skillMatchers: Map<string, RegExp>,
): Map<string, number> {
  const spans = parseJobSpans(resumeText);
  const totals = new Map<string, number>();

  if (spans.length === 0) {
    /** Fallback: attribute all skills to a single window if no dates found */
    const fallbackYears = 3;
    for (const [skill, rx] of skillMatchers) {
      if (rx.test(resumeText)) totals.set(skill, fallbackYears);
    }
    return totals;
  }

  for (const span of spans) {
    const chunkLower = span.text.toLowerCase();
    for (const [skill, rx] of skillMatchers) {
      if (rx.test(chunkLower)) {
        totals.set(skill, (totals.get(skill) ?? 0) + span.years);
      }
    }
  }
  return totals;
}
