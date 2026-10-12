import { NextResponse } from "next/server";
import { fulfillOrder, paymentsMode } from "@/lib/fulfill";
import { getOrder, updateOrder } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const form = await request.formData();
  const orderId = String(form.get("orderId") || "");
  const order = await getOrder(orderId);
  if (!order || order.checkout !== "mock" || paymentsMode() !== "mock") {
    return NextResponse.redirect(new URL("/studio", origin), 303);
  }
  await updateOrder(order.id, (current) => {
    if (current.status === "pending") current.status = "paid";
  });
  try {
    await fulfillOrder(order.id);
  } catch (error) {
    console.error(error);
  }
  return NextResponse.redirect(new URL(`/orders/success?order=${order.id}`, origin), 303);
}
