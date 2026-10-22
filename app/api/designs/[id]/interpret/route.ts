import { NextResponse } from "next/server";
import { describeStyleChange } from "@/lib/proof/diff";
import { PROOF_LLM_ENV, interpretChange } from "@/lib/proof/interpret";
import { recordVersion } from "@/lib/proof/record";
import { getDesign } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const design = await getDesign(id);
  if (!design) return NextResponse.json({ error: "That proof could not be found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { request?: string } | null;
  const text = String(body?.request || "").trim().slice(0, 800);
  if (text.length < 3) return NextResponse.json({ error: "Describe the change you want." }, { status: 400 });
  const result = await interpretChange(text, design.style);
  if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason, env: PROOF_LLM_ENV });
  const changes = result.changes.length ? result.changes : describeStyleChange(design.style, result.style);
  const saved = await recordVersion(design, { style: result.style, note: text, changes });
  return NextResponse.json({ ok: true, version: saved.versions?.at(-1), changes });
}
