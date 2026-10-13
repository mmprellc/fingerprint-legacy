import { NextResponse } from "next/server";
import { contentTypeForKind, openFile, orderObjectKey } from "@/lib/files";
import { getOrder } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await context.params;
  const order = await getOrder(id);
  const key = orderObjectKey(id, kind);
  const contentType = contentTypeForKind(kind);
  if (!order || !key || !contentType || !order.files) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const opened = await openFile(key);
  if (!opened) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (opened.kind === "redirect") return NextResponse.redirect(opened.url, 302);
  const extension = kind === "zip" ? "zip" : kind;
  return new NextResponse(new Uint8Array(opened.body), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="fingerprint-legacy-${id}.${extension}"`,
    },
  });
}
