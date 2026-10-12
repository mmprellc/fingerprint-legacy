import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { productById } from "./products";
import { renderArtwork } from "./fingerprint/render-print";
import {
  getDesign,
  getOrder,
  orderFileDir,
  signDownload,
  updateOrder,
  type Order,
  type Shipping,
} from "./store";

export function paymentsMode(): "mock" | "stripe" {
  return process.env.STRIPE_SECRET_KEY ? "stripe" : "mock";
}

export function printfulMode(): "mock" | "live" {
  return process.env.PRINTFUL_API_KEY ? "live" : "mock";
}

export async function fulfillOrder(orderId: string) {
  const existing = await getOrder(orderId);
  if (!existing) throw new Error("Order not found");
  if (existing.status === "fulfilled" && existing.files?.png) return existing;

  const design = await getDesign(existing.designId);
  if (!design) throw new Error("The design for this order is missing");
  const product = productById(existing.productId);
  const size = product.sizes.find((item) => item.id === existing.sizeId) ?? product.sizes[0];

  try {
    const art = await renderArtwork({
      prints: design.prints,
      style: design.style,
      period: design.period,
      inches: size.inches,
      dpi: size.inches ? 200 : 160,
      frame: product.id === "framed",
    });
    const dir = orderFileDir(orderId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "portrait.svg"), art.svg);
    await fs.writeFile(path.join(dir, "portrait.png"), art.png);
    await fs.writeFile(path.join(dir, "portrait.pdf"), art.pdf);
    const zip = new JSZip();
    zip.file("portrait.svg", art.svg);
    zip.file("portrait.png", art.png);
    zip.file("portrait.pdf", art.pdf);
    await fs.writeFile(path.join(dir, "portrait.zip"), await zip.generateAsync({ type: "nodebuffer" }));

    const origin = process.env.PUBLIC_BASE_URL || "";
    const token = signDownload(orderId);
    const link = origin
      ? `${origin.replace(/\/$/, "")}/orders/${orderId}`
      : `Order ${orderId}`;
    const email = await sendDownloadEmail(existing.email, existing, link);

    let printful: Order["printful"];
    if (product.fulfillment === "printful") {
      printful = await submitPrintful(existing, product.printfulEnv, size.inches);
    }

    return updateOrder(orderId, (order) => {
      order.status = "fulfilled";
      order.files = { svg: true, png: true, pdf: true };
      order.emailDelivery = email;
      order.printful = printful;
      order.error = printful?.error;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fulfillment failed";
    await updateOrder(orderId, (order) => {
      order.status = "failed";
      order.error = message;
    });
    throw error;
  }
}

async function sendDownloadEmail(to: string, order: Order, link: string) {
  const subject = "Your Fingerprint Legacy portrait is ready";
  const body = [
    "Your portrait is ready.",
    "",
    `Order ${order.id}`,
    `Open it here: ${link}`,
    "",
    "The page holds the SVG, the PDF, and the high-resolution PNG.",
    "People leave fingerprints. Love leaves a legacy.",
  ].join("\n");
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) {
    return { mode: "mock" as const, to, subject, body, at: new Date().toISOString() };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text: body }),
  });
  if (!response.ok) {
    const detail = await response.text();
    return {
      mode: "mock" as const,
      to,
      subject,
      body: `${body}\n\nEmail provider returned ${response.status}: ${detail.slice(0, 300)}`,
      at: new Date().toISOString(),
    };
  }
  return { mode: "resend" as const, to, subject, body, at: new Date().toISOString() };
}

async function submitPrintful(order: Order, envName: "PRINTFUL_VARIANT_ARCHIVAL" | "PRINTFUL_VARIANT_FRAMED" | undefined, inches: [number, number] | null) {
  const key = process.env.PRINTFUL_API_KEY;
  if (!key) {
    return {
      mode: "mock" as const,
      id: `mock_${order.id}`,
      status: "draft",
    };
  }
  const variantRaw = envName ? process.env[envName] : "";
  const variantId = Number(variantRaw);
  if (!variantId) {
    return {
      mode: "live" as const,
      status: "needs_variant",
      error: `Set ${envName} to a Printful catalog variant id before live orders can be submitted.`,
    };
  }
  const shipping = order.shipping;
  if (!shipping?.address1 || !shipping.city || !shipping.country || !shipping.postal) {
    return { mode: "live" as const, status: "needs_address", error: "A shipping address is required for the print." };
  }
  const origin = process.env.PUBLIC_BASE_URL;
  if (!origin) {
    return {
      mode: "live" as const,
      status: "needs_public_url",
      error: "Set PUBLIC_BASE_URL so Printful can fetch the print file.",
    };
  }
  const fileUrl = `${origin.replace(/\/$/, "")}/api/orders/${order.id}/files/png`;
  const response = await fetch("https://api.printful.com/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(process.env.PRINTFUL_STORE_ID ? { "X-PF-Store-Id": process.env.PRINTFUL_STORE_ID } : {}),
    },
    body: JSON.stringify({
      external_id: order.id,
      shipping: "STANDARD",
      recipient: toRecipient(shipping, order.email),
      items: [
        {
          variant_id: variantId,
          quantity: 1,
          name: `Fingerprint Legacy ${inches ? inches.join("×") : ""}`.trim(),
          files: [{ url: fileUrl, type: "default" }],
        },
      ],
    }),
  });
  const payload = (await response.json().catch(() => null)) as { result?: { id?: number; status?: string }; error?: { message?: string } } | null;
  if (!response.ok) {
    return {
      mode: "live" as const,
      status: "error",
      error: payload?.error?.message || `Printful returned ${response.status}`,
    };
  }
  return {
    mode: "live" as const,
    id: String(payload?.result?.id ?? ""),
    status: payload?.result?.status || "draft",
  };
}

function toRecipient(shipping: Shipping, email: string) {
  return {
    name: shipping.name,
    address1: shipping.address1,
    address2: shipping.address2 || undefined,
    city: shipping.city,
    state_code: shipping.state,
    country_code: shipping.country,
    zip: shipping.postal,
    phone: shipping.phone || undefined,
    email,
  };
}

export async function markPaid(orderId: string, sessionId?: string) {
  return updateOrder(orderId, (order) => {
    if (order.status === "pending") order.status = "paid";
    if (sessionId) order.stripeSessionId = sessionId;
  });
}

export function orderFilePath(orderId: string, kind: string) {
  const names: Record<string, string> = {
    svg: "portrait.svg",
    png: "portrait.png",
    pdf: "portrait.pdf",
    zip: "portrait.zip",
  };
  const name = names[kind];
  if (!name) return null;
  return path.join(orderFileDir(orderId), name);
}
