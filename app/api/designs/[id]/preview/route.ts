import { NextResponse } from "next/server";
import { openFile, previewObjectKey } from "@/lib/files";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const key = previewObjectKey(id);
  if (!key) return NextResponse.json({ error: "Preview not found" }, { status: 404 });
  const opened = await openFile(key);
  if (!opened) return NextResponse.json({ error: "Preview not found" }, { status: 404 });
  if (opened.kind === "redirect") return NextResponse.redirect(opened.url, 302);
  return new NextResponse(new Uint8Array(opened.body), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
  });
}
