import { NextResponse } from "next/server";
import { fulfillOrder } from "@/lib/fulfill";
import { findOrderBySession, updateOrder } from "@/lib/store";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json({ error: "Stripe webhooks are not configured" }, { status: 400 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  const payload = await request.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded" ||
    event.type === "checkout.session.async_payment_failed"
  ) {
    const session = event.data.object;
    const orderId = session.metadata?.orderId || (await findOrderBySession(session.id))?.id;
    if (!orderId) return NextResponse.json({ received: true });
    if (event.type === "checkout.session.async_payment_failed") {
      await updateOrder(orderId, (order) => {
        order.status = "failed";
        order.error = "Payment failed";
      });
      return NextResponse.json({ received: true });
    }
    if (session.payment_status === "unpaid") return NextResponse.json({ received: true });
    const details = session.collected_information?.shipping_details;
    const address = details?.address;
    await updateOrder(orderId, (order) => {
      if (order.status === "pending") order.status = "paid";
      order.stripeSessionId = session.id;
      if (address) {
        order.shipping = {
          name: details?.name || order.shipping?.name || "",
          phone: session.customer_details?.phone || order.shipping?.phone || "",
          address1: address.line1 || "",
          address2: address.line2 || "",
          city: address.city || "",
          state: address.state || "",
          postal: address.postal_code || "",
          country: address.country || "",
        };
      }
      if (session.customer_details?.email) order.email = session.customer_details.email;
    });
    const current = await findOrderBySession(session.id);
    if (current && current.status !== "fulfilled") {
      try {
        await fulfillOrder(orderId);
      } catch (error) {
        console.error("fulfillment failed", error);
      }
    }
  }
  return NextResponse.json({ received: true });
}
