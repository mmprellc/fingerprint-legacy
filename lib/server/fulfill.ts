import fs from "node:fs";
import path from "node:path";
import { FORMATS } from "../catalog";
import type { ShippingAddress } from "../design";
import { createPrintfulOrder } from "./printful";
import { getOrder, orderDir, updateOrder, type Order } from "./orders";

function receipt(order: Order, origin: string) {
  const link = `${origin}/order/${order.id}`;
  return [
    `Fingerprint Legacy`,
    ``,
    `Your piece is ready.`,
    ``,
    `${FORMATS[order.formatId].name} · ${order.summary}`,
    ``,
    `Download the files: ${link}`,
    ``,
    `This note was saved with the order. Connect an email provider (RESEND_API_KEY) to send it automatically.`,
  ].join("\n");
}

async function deliverDigital(order: Order, origin: string) {
  const note = receipt(order, origin);
  const file = path.join(orderDir(order.id), "receipt.txt");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, note);
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return "queued_mock" as const;
  const from = process.env.EMAIL_FROM || "Fingerprint Legacy <orders@fingerprintlegacy.local>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [order.email],
      subject: "Your Fingerprint Legacy files",
      text: note,
    }),
  });
  if (!response.ok) return "queued_mock" as const;
  return "sent" as const;
}

export async function fulfillPaidOrder(orderId: string, origin: string, shipping?: ShippingAddress) {
  const existing = await getOrder(orderId);
  if (!existing) return null;
  if (existing.status === "fulfilled" && existing.formatId === "digital") return existing;
  if (existing.status === "fulfilled" && existing.printful?.id) return existing;

  let order = existing;
  if (shipping && !order.shipping) {
    const saved = await updateOrder(orderId, { shipping, status: "paid" });
    if (saved) order = saved;
  } else if (order.status === "pending") {
    const saved = await updateOrder(orderId, { status: "paid" });
    if (saved) order = saved;
  }

  if (order.formatId === "digital") {
    const emailDelivery = await deliverDigital(order, origin);
    return updateOrder(orderId, { status: "fulfilled", emailDelivery });
  }

  const printful = await createPrintfulOrder({ ...order, shipping: order.shipping || shipping });
  if (printful.error) {
    return updateOrder(orderId, {
      status: "needs_attention",
      printful,
      error: printful.error,
      emailDelivery: "not_required",
    });
  }
  return updateOrder(orderId, {
    status: "fulfilled",
    printful,
    error: undefined,
    emailDelivery: "not_required",
  });
}
