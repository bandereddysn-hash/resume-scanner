import { useMemo, useState, type ChangeEvent } from "react";
import { analyzeResumeAgainstJd } from "./lib/analyzer";
import {
  extractResumeText,
  extractTextFromResumeFile,
} from "./lib/extractText";
import { scanWithGroq } from "./lib/remoteScan";
import type { GroqNamedScan, GroqTokenUsage } from "./lib/remoteScan";
import { scoreScanResult, verdictShortLabel } from "./lib/scoreScan";
import type { ScanResult } from "./lib/analyzer";

/** Max resumes per compare run (browser + UX + free-tier friendly). */
export const MAX_CANDIDATES = 8;

type ScanSource = "groq" | "local";

type RankedRow = {
  rank: number;
  name: string;
  score: number;
  verdict: ScanResult["verdict"];
  label: string;
  result: ScanResult;
};

type Busy = false | "online" | "offline" | "rank";

function verdictTitle(source: ScanSource, r: ScanResult["verdict"]): string {
  const online = source === "groq";
  if (r === "shortlist")
    return online
      ? "Resume can be shortlisted"
      : "Resume can be shortlisted (offline)";
  if (r === "missing_mandatory_skills")
    return "Not shortlisted: missing mandatory-style skills";
  return "Not shortlisted: not enough experience vs JD hints";
}

function verdictClass(r: ScanResult["verdict"]): string {
  return r === "shortlist" ? "verdict shortlist" : "verdict bad";
}

async function buildCandidateTexts(
  files: File[],
  resumePaste: string,
): Promise<{ name: string; text: string }[]> {
  const list: { name: string; text: string }[] = [];
  for (const f of files.slice(0, MAX_CANDIDATES)) {
    list.push({
      name: f.name,
      text: await extractTextFromResumeFile(f),
    });
  }
  if (resumePaste.trim() && list.length < MAX_CANDIDATES) {
    list.push({ name: "Pasted resume", text: resumePaste.trim() });
  }
  if (list.length === 0 && resumePaste.trim()) {
    list.push({ name: "Pasted resume", text: resumePaste.trim() });
  }
  return list.slice(0, MAX_CANDIDATES);
}

async function buildGroqCandidatesForApi(
  files: File[],
  resumePaste: string,
): Promise<{ name: string; text: string }[]> {
  if (files.length === 0) {
    if (!resumePaste.trim()) {
      throw new Error(
        "Add at least one resume (upload PDF/DOCX and/or paste text) for online scan.",
      );
    }
    return [{ name: "Pasted resume", text: resumePaste.trim() }];
  }
  if (files.length === 1) {
    return [
      {
        name: files[0].name,
        text: await extractResumeText(files[0], resumePaste),
      },
    ];
  }
  return buildCandidateTexts(files, resumePaste);
}

export default function App() {
  const [jd, setJd] = useState("");
  const [resumePaste, setResumePaste] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<Busy>(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanSource, setScanSource] = useState<ScanSource | null>(null);
  const [tokenUsage, setTokenUsage] = useState<GroqTokenUsage | null>(null);
  const [rankRows, setRankRows] = useState<RankedRow[] | null>(null);
  /** When online scan returns multiple resumes from one API call */
  const [aiPack, setAiPack] = useState<GroqNamedScan[] | null>(null);
  const [aiSelected, setAiSelected] = useState(0);

  const canRun = useMemo(() => jd.trim().length > 0, [jd]);
  const firstFile = files[0] ?? null;

  function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    setFiles(picked.slice(0, MAX_CANDIDATES));
    e.target.value = "";
  }

  function removeFileAt(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function runLocalScan() {
    setErr(null);
    setResult(null);
    setScanSource(null);
    setTokenUsage(null);
    setRankRows(null);
    setAiPack(null);
    setAiSelected(0);
    setBusy("offline");
    try {
      const resumeText = await extractResumeText(firstFile, resumePaste);
      const r = analyzeResumeAgainstJd(jd, resumeText);
      setResult(r);
      setScanSource("local");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runGroqScan() {
    setErr(null);
    setResult(null);
    setScanSource(null);
    setTokenUsage(null);
    setRankRows(null);
    setAiPack(null);
    setAiSelected(0);
    setBusy("online");
    try {
      const payload = await buildGroqCandidatesForApi(files, resumePaste);
      const groq = await scanWithGroq(jd, payload);
      if (groq.ok) {
        setAiPack(groq.candidates);
        setAiSelected(0);
        setResult(groq.candidates[0]?.scan ?? null);
        setScanSource("groq");
        setTokenUsage(groq.usage ?? null);
        return;
      }
      if (groq.code === "missing_api_key") {
        setErr(
          "Online scan is not available right now. Please use Scan offline, or try again later.",
        );
        return;
      }
      const hint =
        groq.code === "network_error"
          ? " Check your connection, or use Scan offline."
          : "";
      setErr(`${groq.error}${hint}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runRankOffline() {
    setErr(null);
    setResult(null);
    setScanSource(null);
    setTokenUsage(null);
    setRankRows(null);
    setAiPack(null);
    setAiSelected(0);
    setBusy("rank");
    try {
      if (!jd.trim()) throw new Error("Add a job description.");
      const candidates = await buildCandidateTexts(files, resumePaste);
      if (candidates.length === 0) {
        throw new Error(
          "Add at least one resume: upload PDF/DOCX (up to 8) and/or paste resume text.",
        );
      }
      const rows: RankedRow[] = candidates.map((c) => {
        const scan = analyzeResumeAgainstJd(jd, c.text);
        return {
          rank: 0,
          name: c.name,
          score: scoreScanResult(scan),
          verdict: scan.verdict,
          label: verdictShortLabel(scan.verdict),
          result: scan,
        };
      });
      rows.sort((a, b) => b.score - a.score);
      rows.forEach((r, i) => {
        r.rank = i + 1;
      });
      setRankRows(rows);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const tokenLine =
    tokenUsage &&
    (tokenUsage.prompt_tokens != null ||
      tokenUsage.completion_tokens != null ||
      tokenUsage.total_tokens != null)
      ? `One Groq request used: ${tokenUsage.prompt_tokens ?? "—"} prompt + ${tokenUsage.completion_tokens ?? "—"} completion (${tokenUsage.total_tokens ?? "—"} total) tokens${aiPack && aiPack.length > 1 ? ` — all ${aiPack.length} resumes in a single API call` : ""}.`
      : null;

  const onlineRankRows =
    scanSource === "groq" && aiPack && aiPack.length > 1
      ? [...aiPack]
          .map((c) => ({
            name: c.name,
            score: scoreScanResult(c.scan),
            verdict: c.scan.verdict,
            label: verdictShortLabel(c.scan.verdict),
          }))
          .sort((a, b) => b.score - a.score)
          .map((r, i) => ({ ...r, rank: i + 1 }))
      : null;

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-header__inner">
          <img
            className="site-header__logo"
            src="/paramkara-logo.png"
            alt="Paramkara Corp logo"
            width={160}
            height={80}
          />
          <div className="site-header__text">
            <span className="site-header__company">Paramkara Corp</span>
            <span className="site-header__product">Resume scanner</span>
          </div>
        </div>
      </header>

      <main className="page">
        <div className="intro">
          <h1>Match resumes to a role</h1>
          <p>
            Paste one job description, then add up to{" "}
            <strong>{MAX_CANDIDATES} resumes</strong> (PDF/DOCX) and/or pasted
            text. <strong>Scan online</strong> sends{" "}
            <strong>all selected resumes in one Groq API call</strong> (one
            request; total tokens grow with how much text you send). One file +
            paste are merged into that single candidate.{" "}
            <strong>Scan offline</strong> shows a detailed rules-based view for
            the first file + paste only.{" "}
            <strong>Rank candidates</strong> scores every resume offline and
            sorts best → worst — no API tokens.
          </p>
        </div>

        <div className="grid two">
          <section className="card">
            <label htmlFor="jd">Job description</label>
            <textarea
              id="jd"
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              placeholder="Paste the full job description here…"
            />
          </section>

          <section className="card">
            <label htmlFor="resume">Resume text (optional)</label>
            <textarea
              id="resume"
              value={resumePaste}
              onChange={(e) => setResumePaste(e.target.value)}
              placeholder="Paste one resume here, or rely on files only…"
            />
            <div style={{ height: 12 }} />
            <label htmlFor="files">
              Resumes — PDF or DOCX (up to {MAX_CANDIDATES}, multi-select)
            </label>
            <input
              id="files"
              type="file"
              multiple
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={onPickFiles}
            />
            {files.length > 0 ? (
              <div className="file-chip-row">
                {files.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="file-chip">
                    <span className="mono">{f.name}</span>
                    <button
                      type="button"
                      title="Remove"
                      onClick={() => removeFileAt(i)}
                      disabled={!!busy}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="sub" style={{ marginTop: 8, marginBottom: 0 }}>
                No files selected. Hold Ctrl (Windows) to pick several files at
                once.
              </p>
            )}
          </section>
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn-online"
            onClick={() => void runGroqScan()}
            disabled={!canRun || !!busy}
          >
            {busy === "online" ? "Scanning…" : "Scan online"}
          </button>
          <button
            type="button"
            className="btn-offline"
            onClick={() => void runLocalScan()}
            disabled={!canRun || !!busy}
          >
            {busy === "offline" ? "Scanning…" : "Scan offline"}
          </button>
          <button
            type="button"
            className="btn-rank"
            onClick={() => void runRankOffline()}
            disabled={!canRun || !!busy}
          >
            {busy === "rank" ? "Ranking…" : "Rank candidates"}
          </button>
        </div>

        {err ? <div className="error">{err}</div> : null}

        {result && scanSource ? (
          <section className="card results-block" style={{ marginTop: 20 }}>
            {scanSource === "groq" && aiPack && aiPack.length > 1 ? (
              <>
                <h3 style={{ marginTop: 0 }}>Online batch — quick rank</h3>
                <p className="sub">
                  Same AI run as below; order is by offline-style fit score on
                  the AI result (for sorting only).
                </p>
                <div className="table-wrap" style={{ marginBottom: 16 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Resume</th>
                        <th>Score</th>
                        <th>Verdict</th>
                      </tr>
                    </thead>
                    <tbody>
                      {onlineRankRows?.map((row) => (
                        <tr
                          key={row.name + row.rank}
                          className={row.rank === 1 ? "rank-top" : undefined}
                        >
                          <td className="mono">{row.rank}</td>
                          <td>{row.name}</td>
                          <td className="mono">{row.score}</td>
                          <td>
                            <span
                              className={
                                row.verdict === "shortlist" ? "tag yes" : "tag no"
                              }
                            >
                              {row.label}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <label className="sub" style={{ display: "block", marginBottom: 12 }}>
                  Detailed tables for:{" "}
                  <select
                    className="mono"
                    style={{
                      marginLeft: 6,
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "1px solid var(--border)",
                      fontSize: "0.95rem",
                    }}
                    value={aiSelected}
                    onChange={(e) => {
                      const i = Number(e.target.value);
                      setAiSelected(i);
                      const row = aiPack[i];
                      if (row) setResult(row.scan);
                    }}
                  >
                    {aiPack.map((c, i) => (
                      <option key={c.name + i} value={i}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}

            <div className={verdictClass(result.verdict)}>
              <h2>{verdictTitle(scanSource, result.verdict)}</h2>
              <ul>
                {result.summary.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>

            {scanSource === "groq" && tokenLine ? (
              <div className="token-usage">{tokenLine}</div>
            ) : null}

            <h3>Job description — skills</h3>
            <p className="sub">
              Mandatory-style flags and year hints reflect how the JD states
              requirements.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th>Mandatory-style</th>
                    <th>JD year hint</th>
                  </tr>
                </thead>
                <tbody>
                  {result.jdSkills.length ? (
                    result.jdSkills.map((s) => (
                      <tr key={s.skill}>
                        <td>{s.skill}</td>
                        <td>{s.mandatory ? "Yes" : "No"}</td>
                        <td className="mono">
                          {s.minYears === null ? "—" : `${s.minYears}+ years`}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3}>No skills listed.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <h3>Coverage and experience</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th>In JD</th>
                    <th>In resume</th>
                    <th>Approx. years</th>
                    <th>Mandatory OK</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.skill}>
                      <td>{r.skill}</td>
                      <td>
                        {r.inJd ? (
                          <span className="tag yes">Yes</span>
                        ) : (
                          <span className="tag no">No</span>
                        )}
                      </td>
                      <td>
                        {r.inResume ? (
                          <span className="tag yes">Yes</span>
                        ) : (
                          <span className="tag no">No</span>
                        )}
                      </td>
                      <td className="mono">
                        {r.resumeYears === null ? "—" : `${r.resumeYears}y`}
                      </td>
                      <td>
                        {r.meetsMandatoryExperience === null ? (
                          <span className="tag maybe">n/a</span>
                        ) : r.meetsMandatoryExperience ? (
                          <span className="tag yes">OK</span>
                        ) : (
                          <span className="tag no">Gap</span>
                        )}
                      </td>
                      <td style={{ color: "var(--muted)" }}>{r.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3>Resume-only skills</h3>
            <p className="mono sub" style={{ marginBottom: 0 }}>
              {result.resumeSkills.length
                ? result.resumeSkills.join(", ")
                : "None listed"}
            </p>
          </section>
        ) : null}

        {rankRows && rankRows.length > 0 ? (
          <section className="card rank-wrap">
            <h3>Ranked candidates (offline score)</h3>
            <p className="sub">
              Higher score = better match to the JD using the same rules as
              Scan offline. Best for comparing up to {MAX_CANDIDATES} people for
              one role.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Resume</th>
                    <th>Score</th>
                    <th>Verdict</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {rankRows.map((row) => (
                    <tr
                      key={row.name + row.rank}
                      className={row.rank === 1 ? "rank-top" : undefined}
                    >
                      <td className="mono">{row.rank}</td>
                      <td>{row.name}</td>
                      <td className="mono">{row.score}</td>
                      <td>
                        <span
                          className={
                            row.verdict === "shortlist" ? "tag yes" : "tag no"
                          }
                        >
                          {row.label}
                        </span>
                      </td>
                      <td style={{ color: "var(--muted)", fontSize: "0.86rem" }}>
                        {row.result.summary[0] ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </main>

      <footer className="site-footer">
        © {new Date().getFullYear()} Paramkara Corp
      </footer>
    </div>
  );
}
