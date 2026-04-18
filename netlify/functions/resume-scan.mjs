/**
 * Server-only Groq call. Set GROQ_API_KEY in Netlify → Site configuration → Environment variables.
 * Optional: GROQ_MODEL (default: llama-3.1-8b-instant for speed on free-tier timeouts).
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

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

  let jd;
  let resume;
  try {
    const body = JSON.parse(event.body || "{}");
    jd = typeof body.jd === "string" ? body.jd : "";
    resume = typeof body.resume === "string" ? body.resume : "";
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  if (!jd.trim() || !resume.trim()) {
    return json(400, { error: "jd and resume must be non-empty strings" });
  }

  const model =
    process.env.GROQ_MODEL?.trim() || "llama-3.1-8b-instant";

  const system = `You are a recruiting assistant. Given a job description (JD) and resume text, extract structured data.

Rules:
- Infer skills/tools/technologies/domains explicitly or strongly implied in the JD. Include soft skills only if the JD stresses them as requirements.
- For each JD skill, set mandatory=true if the JD treats it as required/must-have/non-negotiable; use false for nice-to-have.
- minYears: if the JD states a minimum years of experience for that skill (or same bullet/sentence), put an integer; else null.
- resumeYears: estimate total years the candidate likely used that skill in paid roles, using employment dates and bullets. Use decimals like 2.5. If unclear, null.
- meetsMandatoryExperience: for skills where mandatory=true and minYears is set: true if resumeYears >= minYears, false if below or resumeYears unknown; if minYears is null, true if skill appears in resume, false if not, else null when ambiguous.
- rows: one row per skill that appears in JD or resume (union). Include jdMandatory and jdMinYears copied from JD analysis for that skill.
- verdict: "shortlist" only if every mandatory skill is present on resume AND every minYears requirement is met; "missing_mandatory_skills" if any mandatory skill missing from resume; "not_enough_experience" if all mandatory skills appear but at least one fails min years.
- summary: 2-5 short bullet strings explaining the decision.

Output ONLY valid JSON (no markdown) with this exact shape:
{"jdSkills":[{"skill":"string","mandatory":bool,"minYears":number|null}],"resumeSkills":["string"],"rows":[{"skill":"string","inJd":bool,"inResume":bool,"jdMandatory":bool,"jdMinYears":number|null,"resumeYears":number|null,"meetsMandatoryExperience":bool|null,"notes":"string"}],"verdict":"shortlist"|"missing_mandatory_skills"|"not_enough_experience","summary":["string"]}`;

  const user = JSON.stringify({
    jobDescription: jd.slice(0, 120_000),
    resume: resume.slice(0, 120_000),
  });

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
        max_tokens: 4096,
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

  let scan;
  try {
    scan = JSON.parse(stripJsonFence(content));
  } catch (e) {
    return json(502, {
      error: "model_json_parse_error",
      message: e instanceof Error ? e.message : String(e),
      snippet: content.slice(0, 1500),
    });
  }

  return json(200, { scan, model });
};
