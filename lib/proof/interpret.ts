import { readPrintStyle } from "../fingerprint/read-style";
import type { PrintStyle } from "../fingerprint/types";

export const PROOF_LLM_ENV = "OPENAI_API_KEY";

export type InterpretResult =
  | { ok: true; style: PrintStyle; changes: string[] }
  | { ok: false; reason: string };

const SYSTEM = `You edit a fingerprint portrait's settings. Reply with JSON only:
{"changes":["short past-tense sentence"],"patch":{...}}
patch may include headerName, headerDates, signature (empty string turns it off), centerName, centerDetail, secondaryName, secondaryDetail, marriage, marriageDate, plaqueLines (string array), names (string array), nameMax ({name,max} array), nameHold (string array of names excluded from repeats), scriptures, stories, filler ("stories"|"names"|"lines"), nameGap ("dot"|"space"), textScale (0.86 standard or 0.77 smaller).
Keep spelling exactly as the customer wrote it. Do not invent names. Stories stay whole paragraphs.`;

export async function interpretChange(request: string, style: PrintStyle): Promise<InterpretResult> {
  const key = (process.env[PROOF_LLM_ENV] || "").trim();
  if (!key) {
    return {
      ok: false,
      reason: `Free-text changes need ${PROOF_LLM_ENV}. The controls on this page still save a revision.`,
    };
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_PROOF_MODEL || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Request: ${request}\n\nCurrent settings:\n${JSON.stringify(style)}` },
      ],
    }),
  });
  if (!response.ok) {
    return { ok: false, reason: "The writing assistant did not answer. Use the controls on this page." };
  }
  const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = payload.choices?.[0]?.message?.content || "";
  let parsed: { changes?: unknown; patch?: Partial<PrintStyle> };
  try {
    parsed = JSON.parse(raw) as { changes?: unknown; patch?: Partial<PrintStyle> };
  } catch {
    return { ok: false, reason: "The writing assistant answered in a form that could not be applied." };
  }
  const next = readPrintStyle({ ...style, ...(parsed.patch ?? {}) });
  const changes = Array.isArray(parsed.changes) ? parsed.changes.map((item) => String(item).slice(0, 180)).filter(Boolean).slice(0, 8) : [];
  if (!changes.length) changes.push("Applied the written request to the proof settings.");
  return { ok: true, style: next, changes };
}
