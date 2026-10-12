import { NextResponse } from "next/server";
import type Stripe from "stripe";
import type { ShippingAddress } from "@/lib/design";
import { fulfillPaidOrder } from "@/lib/server/fulfill";
import { updateOrder } from "@/lib/server/orders";
import { getStripe } from "@/lib/server/stripe";

export const runtime = "nodejs";

function shippingFromSession(session: Stripe.Checkout.Session): ShippingAddress | undefined {
  const details = session.collected_information?.shipping_details;
  const address = details?.address;
  if (!address?.line1 || !address.city || !address.country || !address.postal_code) return undefined;
  return {
    name: details?.name || session.customer_details?.name || "Customer",
    address1: address.line1,
    address2: address.line2 || undefined,
    city: address.city,
    state: address.state || address.country,
    postal: address.postal_code,
    country: address.country,
    phone: session.customer_details?.phone || undefined,
  };
}

async function onSession(session: Stripe.Checkout.Session, origin: string) {
  const orderId = session.metadata?.orderId || session.client_reference_id;
  if (!orderId) return;
  if (session.payment_status === "unpaid") return;
  await fulfillPaidOrder(orderId, origin, shippingFromSession(session));
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET is required to verify webhook signatures." }, { status: 500 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    await onSession(event.data.object as Stripe.Checkout.Session, origin);
  }
  if (event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.orderId || session.client_reference_id;
    if (orderId) {
      await updateOrder(orderId, { status: "needs_attention", error: "The payment was not completed." });
    }
  }
  return NextResponse.json({ received: true });
}
