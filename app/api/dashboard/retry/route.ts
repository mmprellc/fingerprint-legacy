import { NextResponse } from "next/server";
import { isOwner } from "@/lib/server/auth";
import { fulfillPaidOrder } from "@/lib/server/fulfill";
import { getOrder, updateOrder } from "@/lib/server/orders";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isOwner())) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const form = await request.formData();
  const id = String(form.get("orderId") || "");
  const order = await getOrder(id);
  if (!order) return NextResponse.redirect(new URL("/dashboard", request.url), 303);
  await updateOrder(id, { status: "paid", error: undefined });
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  await fulfillPaidOrder(id, origin, order.shipping);
  return NextResponse.redirect(new URL("/dashboard", request.url), 303);
}
