import JSZip from "jszip";
import { orderObjectKey, putBytes, signedFileUrl } from "./files";
import { productById } from "./products";
import { renderArtwork } from "./fingerprint/render-print";
import { isProductionDeploy, requiresDurableStorage } from "./runtime";
import { secretKeyMode } from "./stripe";
import {
  getDesign,
  getOrder,
  updateOrder,
  type Order,
  type Shipping,
} from "./store";

export function paymentsMode(): "mock" | "stripe" {
  return secretKeyMode() === "unset" ? "mock" : "stripe";
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
    const zip = new JSZip();
    zip.file("portrait.svg", art.svg);
    zip.file("portrait.png", art.png);
    zip.file("portrait.pdf", art.pdf);
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const written: Array<[string, string, Buffer]> = [
      ["svg", "image/svg+xml", Buffer.from(art.svg)],
      ["png", "image/png", art.png],
      ["pdf", "application/pdf", art.pdf],
      ["zip", "application/zip", zipBuffer],
    ];
    for (const [kind, contentType, body] of written) {
      const key = orderObjectKey(orderId, kind);
      if (!key) throw new Error("Invalid order id");
      await putBytes(key, body, contentType);
    }

    const origin = (process.env.PUBLIC_BASE_URL || "").trim();
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
    if (requiresDurableStorage()) {
      return {
        mode: "live" as const,
        status: "not_configured",
        error: "Set PRINTFUL_API_KEY, PRINTFUL_STORE_ID, and the variant ids before a paid print can ship.",
      };
    }
    return {
      mode: "mock" as const,
      id: `mock_${order.id}`,
      status: "draft",
    };
  }
  const storeId = (process.env.PRINTFUL_STORE_ID || "").trim();
  if (!storeId && isProductionDeploy()) {
    return {
      mode: "live" as const,
      status: "needs_store",
      error: "Set PRINTFUL_STORE_ID to the store id from the Printful dashboard.",
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
  const pngKey = orderObjectKey(order.id, "png");
  const signed = pngKey ? await signedFileUrl(pngKey, 6 * 60 * 60) : null;
  const origin = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  const fileUrl = signed || (origin ? `${origin}/api/orders/${order.id}/files/png` : "");
  if (!fileUrl) {
    return {
      mode: "live" as const,
      status: "needs_public_url",
      error: "Set PUBLIC_BASE_URL so Printful can fetch the print file.",
    };
  }
  const response = await fetch("https://api.printful.com/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(storeId ? { "X-PF-Store-Id": storeId } : {}),
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
