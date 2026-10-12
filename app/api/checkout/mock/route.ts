import { NextResponse } from "next/server";
import { fulfillPaidOrder } from "@/lib/server/fulfill";
import { getOrder } from "@/lib/server/orders";
import { paymentsMode } from "@/lib/server/stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (paymentsMode() !== "mock") {
    return NextResponse.json({ error: "Mock checkout is only available without a Stripe key." }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as { orderId?: string } | null;
  const order = body?.orderId ? await getOrder(body.orderId) : null;
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  const fulfilled = await fulfillPaidOrder(order.id, origin, order.shipping);
  return NextResponse.json({ order: fulfilled });
}
