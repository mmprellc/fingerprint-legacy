import { NextResponse } from "next/server";
import { getOrder } from "@/lib/server/orders";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const order = await getOrder(id);
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  return NextResponse.json({
    order: {
      id: order.id,
      status: order.status,
      email: order.email,
      summary: order.summary,
      formatId: order.formatId,
      sizeId: order.sizeId,
      amountCents: order.amountCents,
      emailDelivery: order.emailDelivery,
      printful: order.printful ? { status: order.printful.status, mode: order.printful.mode } : undefined,
      error: order.error,
      ready: order.status === "fulfilled" || order.status === "paid" || order.status === "needs_attention",
    },
  });
}
