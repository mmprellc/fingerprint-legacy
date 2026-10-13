import { NextResponse } from "next/server";
import { paymentsMode } from "@/lib/fulfill";
import { productById } from "@/lib/products";
import { getDesign, createOrder, type Shipping } from "@/lib/store";
import { getStripe, integrationIdentifier } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const designId = String(form.get("designId") || "");
  const design = await getDesign(designId);
  const origin = new URL(request.url).origin;
  if (!design) {
    return NextResponse.redirect(new URL("/studio", origin), 303);
  }
  const email = String(form.get("email") || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.redirect(new URL(`/checkout?design=${designId}&error=email`, origin), 303);
  }
  const product = productById(String(form.get("productId") || design.productId));
  if (!product.available) {
    return NextResponse.redirect(new URL(`/checkout?design=${designId}&error=product`, origin), 303);
  }
  const size = product.sizes.find((item) => item.id === String(form.get("sizeId") || "")) ?? product.sizes[0];
  const shipping = readShipping(form);
  if (product.fulfillment === "printful" && paymentsMode() === "mock" && !shipping.address1) {
    return NextResponse.redirect(new URL(`/checkout?design=${designId}&error=address`, origin), 303);
  }

  const order = await createOrder({
    email,
    productId: product.id,
    sizeId: size.id,
    amountCents: product.priceCents,
    checkout: paymentsMode(),
    designId,
    shipping: product.fulfillment === "printful" ? shipping : undefined,
  });

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.redirect(new URL(`/checkout/mock?order=${order.id}`, origin), 303);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: email,
    client_reference_id: order.id,
    metadata: { orderId: order.id, designId },
    integration_identifier: integrationIdentifier(),
    success_url: `${origin}/orders/success?order=${order.id}`,
    cancel_url: `${origin}/checkout?design=${designId}`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: product.priceCents,
          product_data: { name: product.name, description: product.summary },
        },
      },
    ],
    ...(product.fulfillment === "printful"
      ? {
          shipping_address_collection: { allowed_countries: ["US", "CA", "GB", "AU", "NZ", "IE"] as const },
          phone_number_collection: { enabled: true },
          shipping_options: [
            {
              shipping_rate_data: {
                type: "fixed_amount" as const,
                fixed_amount: { amount: 0, currency: "usd" },
                display_name: "Standard shipping, included",
              },
            },
          ],
        }
      : {}),
  });

  const { updateOrder } = await import("@/lib/store");
  await updateOrder(order.id, (current) => {
    current.stripeSessionId = session.id;
  });
  if (!session.url) {
    return NextResponse.redirect(new URL(`/checkout?design=${designId}&error=stripe`, origin), 303);
  }
  return NextResponse.redirect(session.url, 303);
}

function readShipping(form: FormData): Shipping {
  return {
    name: String(form.get("name") || "").slice(0, 120),
    phone: String(form.get("phone") || "").slice(0, 40),
    address1: String(form.get("address1") || "").slice(0, 160),
    address2: String(form.get("address2") || "").slice(0, 160),
    city: String(form.get("city") || "").slice(0, 80),
    state: String(form.get("state") || "").slice(0, 40),
    postal: String(form.get("postal") || "").slice(0, 20),
    country: String(form.get("country") || "US").slice(0, 2).toUpperCase(),
  };
}
