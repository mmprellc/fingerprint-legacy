import { NextResponse } from "next/server";
import { designAssetKey, openFile } from "@/lib/files";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await context.params;
  const key = designAssetKey(id, name);
  if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const opened = await openFile(key);
  if (!opened || opened.kind === "redirect") {
    if (opened?.kind === "redirect") return NextResponse.redirect(opened.url);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(opened.body), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=60" },
  });
}
