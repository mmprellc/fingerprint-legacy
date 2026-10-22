import { NextResponse } from "next/server";
import { getDesign, newId, saveDesign } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const design = await getDesign(id);
  if (!design) return NextResponse.json({ error: "That proof could not be found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { text?: string; author?: string; token?: string } | null;
  if (body?.token && body.token !== design.shareToken) {
    return NextResponse.json({ error: "This family link is not valid." }, { status: 403 });
  }
  const text = String(body?.text || "").trim().slice(0, 600);
  if (text.length < 2) return NextResponse.json({ error: "Write a short comment." }, { status: 400 });
  const comment = {
    id: newId("cmt"),
    at: new Date().toISOString(),
    author: String(body?.author || "Family").trim().slice(0, 40) || "Family",
    text,
  };
  design.comments = [...(design.comments ?? []), comment];
  await saveDesign(design);
  return NextResponse.json({ comment });
}
