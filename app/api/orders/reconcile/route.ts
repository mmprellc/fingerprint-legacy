import { NextResponse } from "next/server";
import { fulfillPaidOrder } from "@/lib/server/fulfill";
import { getOrder } from "@/lib/server/orders";
import { getStripe, paymentsMode } from "@/lib/server/stripe";
import type { ShippingAddress } from "@/lib/design";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { orderId?: string; sessionId?: string } | null;
  if (!body?.orderId) return NextResponse.json({ error: "Missing order." }, { status: 400 });
  const order = await getOrder(body.orderId);
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.status === "fulfilled") return NextResponse.json({ order });
  if (paymentsMode() !== "stripe" || !body.sessionId) return NextResponse.json({ order });

  const session = await getStripe().checkout.sessions.retrieve(body.sessionId);
  const orderId = session.metadata?.orderId || session.client_reference_id;
  if (orderId !== order.id || session.payment_status === "unpaid") return NextResponse.json({ order });

  const details = session.collected_information?.shipping_details;
  const address = details?.address;
  const shipping: ShippingAddress | undefined =
    address?.line1 && address.city && address.country && address.postal_code
      ? {
          name: details?.name || order.customerName,
          address1: address.line1,
          address2: address.line2 || undefined,
          city: address.city,
          state: address.state || address.country,
          postal: address.postal_code,
          country: address.country,
          phone: session.customer_details?.phone || undefined,
        }
      : undefined;

  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  const next = await fulfillPaidOrder(order.id, origin, shipping);
  return NextResponse.json({ order: next });
}
