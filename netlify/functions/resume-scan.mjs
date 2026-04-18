/**
 * One Groq chat/completions call per request — body can include 1–8 resumes.
 * Set GROQ_API_KEY in Netlify. Optional: GROQ_MODEL (default llama-3.1-8b-instant).
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const JD_MAX = 60_000;
const PER_RESUME_MAX = 10_000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(statusCode, bodyObj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...cors },
    body: JSON.stringify(bodyObj),
  };
}

function stripJsonFence(s) {
  const t = s.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1].trim() : t;
}

function normalizeCandidates(body) {
  const jd = typeof body.jd === "string" ? body.jd : "";
  const out = [];
  if (Array.isArray(body.candidates)) {
    for (let i = 0; i < body.candidates.length; i++) {
      const c = body.candidates[i];
      if (!c || typeof c !== "object") continue;
      const resume = typeof c.resume === "string" ? c.resume : "";
      if (!resume.trim()) continue;
      const name =
        typeof c.name === "string" && c.name.trim()
          ? c.name.trim()
          : `Resume ${out.length + 1}`;
      out.push({ name, resume: resume.trim() });
    }
  }
  if (out.length === 0 && typeof body.resume === "string" && body.resume.trim()) {
    out.push({ name: "Resume", resume: body.resume.trim() });
  }
  return { jd, candidates: out.slice(0, 8) };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return json(503, {
      error: "missing_api_key",
      message:
        "GROQ_API_KEY is not set. In Netlify: Site settings → Environment variables → add GROQ_API_KEY.",
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { jd, candidates } = normalizeCandidates(body);
  if (!jd.trim() || candidates.length === 0) {
    return json(400, {
      error: "Need jd and at least one resume (candidates[].resume or legacy resume string).",
    });
  }

  const model = process.env.GROQ_MODEL?.trim() || "llama-3.1-8b-instant";

  const system = `You are a recruiting assistant. You receive ONE job description (JD) and MULTIPLE resumes (each has a "name" and "text").

For EACH resume independently:
- Infer skills/tools/technologies/domains explicitly or strongly implied in the JD. Include soft skills only if the JD stresses them as requirements.
- For each JD skill in that resume's analysis, set mandatory=true if the JD treats it as required/must-have; else false.
- minYears: integer if the JD states a minimum years for that skill near that requirement; else null.
- resumeYears: estimate years that candidate used that skill in paid roles from dates/bullets; decimals ok; else null.
- meetsMandatoryExperience: for mandatory=true and minYears set: true if resumeYears >= minYears; false if below or unknown; if minYears null: true if skill on resume, false if not, else null.
- rows: union of skills appearing in JD or that resume.
- verdict per resume: "shortlist" only if every mandatory skill is on that resume AND minYears met; "missing_mandatory_skills" if any mandatory missing; "not_enough_experience" if all mandatory present but a year requirement fails.
- summary: 2-5 short strings for that resume.

Return ONLY valid JSON (no markdown) with this exact top-level shape:
{"candidates":[{"name":"string (must match input name)","scan":{"jdSkills":[{"skill":"string","mandatory":bool,"minYears":number|null}],"resumeSkills":["string"],"rows":[{"skill":"string","inJd":bool,"inResume":bool,"jdMandatory":bool,"jdMinYears":number|null,"resumeYears":number|null,"meetsMandatoryExperience":bool|null,"notes":"string"}],"verdict":"shortlist"|"missing_mandatory_skills"|"not_enough_experience","summary":["string"]}}]}

You MUST output exactly one object in "candidates" for each input resume, in the SAME ORDER, with the SAME "name" strings.`;

  const user = JSON.stringify({
    jobDescription: jd.slice(0, JD_MAX),
    resumes: candidates.map((c) => ({
      name: c.name,
      text: c.resume.slice(0, PER_RESUME_MAX),
    })),
  });

  const maxTokens = Math.min(16384, 2200 + candidates.length * 1400);

  let groqRes;
  try {
    groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (e) {
    return json(502, {
      error: "groq_fetch_failed",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const groqText = await groqRes.text();
  if (!groqRes.ok) {
    return json(502, {
      error: "groq_http_error",
      status: groqRes.status,
      body: groqText.slice(0, 2000),
    });
  }

  let groqJson;
  try {
    groqJson = JSON.parse(groqText);
  } catch {
    return json(502, { error: "groq_invalid_json", body: groqText.slice(0, 500) });
  }

  const content = groqJson?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    return json(502, { error: "groq_empty_content", groqJson });
  }

  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(content));
  } catch (e) {
    return json(502, {
      error: "model_json_parse_error",
      message: e instanceof Error ? e.message : String(e),
      snippet: content.slice(0, 1500),
    });
  }

  if (!Array.isArray(parsed.candidates) || parsed.candidates.length === 0) {
    return json(502, {
      error: "model_missing_candidates",
      snippet: content.slice(0, 1200),
    });
  }

  const usage =
    groqJson?.usage && typeof groqJson.usage === "object"
      ? {
          prompt_tokens: groqJson.usage.prompt_tokens ?? null,
          completion_tokens: groqJson.usage.completion_tokens ?? null,
          total_tokens: groqJson.usage.total_tokens ?? null,
        }
      : null;

  return json(200, {
    candidates: parsed.candidates,
    model,
    usage,
    expectedCount: candidates.length,
  });
};
