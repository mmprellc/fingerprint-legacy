import { NextResponse } from "next/server";
import { getOrder, readOrderFile } from "@/lib/server/orders";

export const runtime = "nodejs";

const types = {
  svg: { type: "image/svg+xml", name: "fingerprint-legacy.svg" },
  png: { type: "image/png", name: "fingerprint-legacy.png" },
  pdf: { type: "application/pdf", name: "fingerprint-legacy.pdf" },
} as const;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const order = await getOrder(id);
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.status === "pending") return NextResponse.json({ error: "This order is not paid yet." }, { status: 402 });
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== "svg" && kind !== "png" && kind !== "pdf") {
    return NextResponse.json({ error: "Unknown file." }, { status: 400 });
  }
  const body = readOrderFile(order, kind);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": types[kind].type,
      "Content-Disposition": `attachment; filename="${types[kind].name}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
