import { useMemo, useState } from "react";
import { analyzeResumeAgainstJd } from "./lib/analyzer";
import { extractResumeText } from "./lib/extractText";
import { scanWithGroq } from "./lib/remoteScan";
import type { ScanResult } from "./lib/analyzer";

type ScanSource = "groq" | "local";

function verdictTitle(source: ScanSource, r: ScanResult["verdict"]): string {
  const ai = source === "groq";
  if (r === "shortlist")
    return ai
      ? "Resume can be shortlisted (AI)"
      : "Resume can be shortlisted (offline rules)";
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanSource, setScanSource] = useState<ScanSource | null>(null);
  const [groqModel, setGroqModel] = useState<string | null>(null);

  const canRun = useMemo(() => jd.trim().length > 0, [jd]);

  async function runLocalScan() {
    setErr(null);
    setResult(null);
    setScanSource(null);
    setGroqModel(null);
    setBusy(true);
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
    setGroqModel(null);
    setBusy(true);
    try {
      const resumeText = await extractResumeText(file, resumePaste);
      const groq = await scanWithGroq(jd, resumeText);
      if (groq.ok) {
        setResult(groq.scan);
        setScanSource("groq");
        setGroqModel(groq.model ?? null);
        return;
      }
      if (groq.code === "missing_api_key") {
        setErr(
          "Groq is not configured yet. In Netlify: Site configuration → Environment variables → add GROQ_API_KEY (your key from console.groq.com). Redeploy, then try again. You can still use “Scan offline” below.",
        );
        return;
      }
      const hint =
        groq.code === "network_error"
          ? " Could not reach /.netlify/functions/resume-scan. For local dev run `npm run dev:netlify` (or start Netlify dev on port 8888 with Vite’s proxy), or deploy to Netlify."
          : "";
      setErr(`${groq.error}${hint}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <h1>Resume scanner</h1>
        <p>
          Paste a job description, then upload a PDF or DOCX resume (or paste
          plain text). Use Groq on the server (Netlify Function + env key) for
          an AI pass, or scan offline with glossary rules and date heuristics.
        </p>
      </header>

      <div className="banner">
        <strong>Groq on Netlify:</strong> create a key at{" "}
        <a href="https://console.groq.com/">console.groq.com</a>, then in
        Netlify go to <em>Site configuration → Environment variables</em> and
        add <span className="mono">GROQ_API_KEY</span>. Optional:{" "}
        <span className="mono">GROQ_MODEL</span> (default{" "}
        <span className="mono">llama-3.1-8b-instant</span>). Redeploy after
        saving. Never put the key in <span className="mono">VITE_*</span>{" "}
        variables—the browser must not see it.
      </div>

      <div className="grid two">
        <section className="card">
          <label htmlFor="jd">Job description</label>
          <textarea
            id="jd"
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            placeholder="Paste the full JD here…"
          />
        </section>

        <section className="card">
          <label htmlFor="resume">Resume</label>
          <textarea
            id="resume"
            value={resumePaste}
            onChange={(e) => setResumePaste(e.target.value)}
            placeholder="Paste resume text, or rely on file upload below…"
          />
          <div style={{ height: 10 }} />
          <label htmlFor="file">Upload PDF or DOCX (optional)</label>
          <input
            id="file"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div className="row" style={{ marginTop: 10 }}>
              <span className="pill">
                Selected file:{" "}
                <span className="mono">{file.name}</span>
              </span>
              <button
                type="button"
                className="primary"
                onClick={() => setFile(null)}
                disabled={busy}
                style={{
                  background: "transparent",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                }}
              >
                Clear file
              </button>
            </div>
          ) : null}
        </section>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button
          type="button"
          className="primary"
          onClick={() => void runGroqScan()}
          disabled={!canRun || busy}
        >
          {busy ? "Scanning…" : "Scan with AI (Groq)"}
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => void runLocalScan()}
          disabled={!canRun || busy}
          style={{
            background: "transparent",
            color: "var(--text)",
            border: "1px solid var(--border)",
          }}
        >
          Scan offline (rules)
        </button>
        {scanSource === "groq" && groqModel ? (
          <span className="pill">
            Model: <span className="mono">{groqModel}</span>
          </span>
        ) : (
          <span className="pill">Functions: /.netlify/functions/resume-scan</span>
        )}
      </div>

      {err ? <div className="error">{err}</div> : null}

      {result && scanSource ? (
        <section className="card" style={{ marginTop: 14 }}>
          <div className={verdictClass(result.verdict)}>
            <h2>{verdictTitle(scanSource, result.verdict)}</h2>
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--muted)" }}>
              {result.summary.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>

          <h3 style={{ marginTop: 16, marginBottom: 8 }}>JD skills</h3>
          <p style={{ marginTop: 0, color: "var(--muted)", fontSize: "0.92rem" }}>
            {scanSource === "groq"
              ? "Mandatory flags and year hints come from the model’s reading of the JD."
              : "Mandatory-style flags use wording like “must/required” and bullets under headings like “Requirements”."}
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

          <h3 style={{ marginTop: 16, marginBottom: 8 }}>Coverage and experience</h3>
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
                    <td>{r.inJd ? <span className="tag yes">Yes</span> : <span className="tag no">No</span>}</td>
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

          <h3 style={{ marginTop: 16, marginBottom: 8 }}>Resume-only skills</h3>
          <p className="mono" style={{ marginTop: 0, color: "var(--muted)" }}>
            {result.resumeSkills.length
              ? result.resumeSkills.join(", ")
              : "None listed"}
          </p>
        </section>
      ) : null}
    </div>
  );
}
