import { NextResponse } from "next/server";
import { getOrder } from "@/lib/store";
import { productById } from "@/lib/products";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const order = await getOrder(id);
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const product = productById(order.productId);
  return NextResponse.json({
    id: order.id,
    status: order.status,
    email: order.email,
    product: product.name,
    amountCents: order.amountCents,
    files: order.files ?? null,
    printful: order.printful ?? null,
    emailDelivery: order.emailDelivery ? { mode: order.emailDelivery.mode, at: order.emailDelivery.at } : null,
    error: order.error ?? null,
  });
}
