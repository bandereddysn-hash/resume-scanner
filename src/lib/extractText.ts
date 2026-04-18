import mammoth from "mammoth";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

export async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ");
    parts.push(line);
  }
  return parts.join("\n\n").replace(/\s+/g, " ").trim();
}

export async function extractTextFromDocx(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
  return value.replace(/\r\n/g, "\n").trim();
}

export async function extractResumeText(
  file: File | null,
  pasted: string,
): Promise<string> {
  const paste = pasted.trim();
  if (file) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".pdf")) {
      const t = await extractTextFromPdf(file);
      return [t, paste].filter(Boolean).join("\n\n");
    }
    if (lower.endsWith(".docx")) {
      const t = await extractTextFromDocx(file);
      return [t, paste].filter(Boolean).join("\n\n");
    }
    throw new Error("Unsupported file type. Use PDF or DOCX.");
  }
  if (!paste) throw new Error("Upload a resume or paste resume text.");
  return paste;
}
