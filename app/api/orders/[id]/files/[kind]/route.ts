import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { orderFilePath } from "@/lib/fulfill";
import { getOrder } from "@/lib/store";

export const runtime = "nodejs";

const types: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  pdf: "application/pdf",
  zip: "application/zip",
};

export async function GET(_request: Request, context: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await context.params;
  const order = await getOrder(id);
  const file = orderFilePath(id, kind);
  if (!order || !file || !order.files) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const body = await fs.readFile(file);
    return new NextResponse(body, {
      headers: {
        "Content-Type": types[kind] || "application/octet-stream",
        "Content-Disposition": `attachment; filename="fingerprint-legacy-${id}.${kind === "zip" ? "zip" : kind}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
