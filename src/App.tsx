import { useMemo, useState } from "react";
import { analyzeResumeAgainstJd } from "./lib/analyzer";
import { extractResumeText } from "./lib/extractText";
import { scanWithGroq } from "./lib/remoteScan";
import type { ScanResult } from "./lib/analyzer";

type ScanSource = "groq" | "local";

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

export default function App() {
  const [jd, setJd] = useState("");
  const [resumePaste, setResumePaste] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<false | "online" | "offline">(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanSource, setScanSource] = useState<ScanSource | null>(null);

  const canRun = useMemo(() => jd.trim().length > 0, [jd]);

  async function runLocalScan() {
    setErr(null);
    setResult(null);
    setScanSource(null);
    setBusy("offline");
    try {
      const resumeText = await extractResumeText(file, resumePaste);
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
    setBusy("online");
    try {
      const resumeText = await extractResumeText(file, resumePaste);
      const groq = await scanWithGroq(jd, resumeText);
      if (groq.ok) {
        setResult(groq.scan);
        setScanSource("groq");
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
          <h1>Match resume to role</h1>
          <p>
            Paste the job description, add your resume as PDF, DOCX, or plain
            text — then run an online or offline scan to see skills coverage and
            fit at a glance.
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
            <label htmlFor="resume">Resume</label>
            <textarea
              id="resume"
              value={resumePaste}
              onChange={(e) => setResumePaste(e.target.value)}
              placeholder="Paste resume text, or upload a file below…"
            />
            <div style={{ height: 12 }} />
            <label htmlFor="file">Upload PDF or DOCX (optional)</label>
            <input
              id="file"
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div className="row" style={{ marginTop: 12 }}>
                <span className="pill">
                  <span className="mono">{file.name}</span>
                </span>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setFile(null)}
                  disabled={!!busy}
                >
                  Remove file
                </button>
              </div>
            ) : null}
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
        </div>

        {err ? <div className="error">{err}</div> : null}

        {result && scanSource ? (
          <section className="card results-block" style={{ marginTop: 20 }}>
            <div className={verdictClass(result.verdict)}>
              <h2>{verdictTitle(scanSource, result.verdict)}</h2>
              <ul>
                {result.summary.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>

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
      </main>

      <footer className="site-footer">
        © {new Date().getFullYear()} Paramkara Corp
      </footer>
    </div>
  );
}
