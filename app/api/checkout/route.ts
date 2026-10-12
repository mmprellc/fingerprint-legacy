import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { FORMATS, money, SIZES } from "@/lib/catalog";
import { checkoutSchema } from "@/lib/design";
import { renderPrintFiles } from "@/lib/server/artwork";
import { createOrder, orderDir, updateOrder } from "@/lib/server/orders";
import { getStripe, INTEGRATION_IDENTIFIER, paymentsMode } from "@/lib/server/stripe";
import path from "node:path";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the email, the print, and the words, then try again." }, { status: 400 });
  }
  const design = parsed.data;
  const format = FORMATS[design.formatId];
  if (format.ships && paymentsMode() === "mock" && !design.shipping) {
    return NextResponse.json({ error: "A shipping address is required for a physical print." }, { status: 400 });
  }

  let files;
  try {
    files = await renderPrintFiles(design);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The print could not be prepared.";
    return NextResponse.json({ error: message }, { status: 422 });
  }

  const id = crypto.randomUUID();
  const dir = orderDir(id);
  const amountCents = format.prices[design.sizeId];
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  const order = await createOrder(
    {
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      email: design.email,
      customerName: design.customerName,
      status: "pending",
      formatId: design.formatId,
      sizeId: design.sizeId,
      amountCents,
      mode: paymentsMode(),
      shipping: design.shipping,
      emailDelivery: design.formatId === "digital" ? "pending" : "not_required",
      files: {
        svg: path.join(dir, "artwork.svg"),
        png: path.join(dir, "artwork.png"),
        pdf: path.join(dir, "artwork.pdf"),
      },
      summary: `${format.name} · ${SIZES[design.sizeId].label}`,
    },
    files,
  );

  if (paymentsMode() === "mock") {
    return NextResponse.json({ mode: "mock", orderId: order.id, url: `/checkout/mock?order=${order.id}` });
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: design.email,
    client_reference_id: order.id,
    integration_identifier: INTEGRATION_IDENTIFIER,
    metadata: { orderId: order.id },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: `Fingerprint Legacy — ${format.name}`,
            description: `${SIZES[design.sizeId].label}. ${format.summary} ${money(amountCents)}.`,
          },
        },
      },
    ],
    ...(format.ships
      ? {
          shipping_address_collection: {
            allowed_countries: ["US", "CA", "GB", "AU", "NZ", "IE", "DE", "FR", "NL", "SE", "NO", "DK", "AT", "BE", "CH", "FI", "ES", "IT", "PT"] as const,
          },
        }
      : {}),
    success_url: `${origin}/order/success?order=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/checkout?canceled=1`,
  });

  await updateOrder(order.id, { stripeSessionId: session.id });
  return NextResponse.json({ mode: "stripe", orderId: order.id, url: session.url });
}
