import fs from "node:fs";
import { FORMATS, PRINTFUL_VARIANTS, type FormatId, type SizeId } from "../catalog";
import type { Order } from "./orders";

export type PrintfulResult = {
  id: string;
  status: string;
  mode: "live" | "mock";
  error?: string;
};

function variantId(formatId: FormatId, sizeId: SizeId) {
  if (formatId === "digital") throw new Error("Digital orders are not printed.");
  const override = process.env[`PRINTFUL_VARIANT_${formatId.toUpperCase()}_${sizeId.toUpperCase()}`];
  if (override && /^\d+$/.test(override)) return Number(override);
  return PRINTFUL_VARIANTS[formatId][sizeId];
}

/**
 * Create a Printful order for a paid physical piece.
 * Without PRINTFUL_API_KEY this returns a mock so the rest of checkout still completes.
 * Set PRINTFUL_AUTO_CONFIRM=false to leave a draft instead of submitting it to production.
 */
export async function createPrintfulOrder(order: Order): Promise<PrintfulResult> {
  const key = process.env.PRINTFUL_API_KEY?.trim();
  if (!order.shipping) {
    return { id: "", status: "missing_address", mode: key ? "live" : "mock", error: "A shipping address is required." };
  }
  if (!key) {
    return {
      id: `mock_${order.id.replace(/-/g, "").slice(0, 12)}`,
      status: "mocked",
      mode: "mock",
    };
  }

  try {
    const png = fs.readFileSync(order.files.png);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "fingerprint-legacy.png");
    const uploaded = await fetch("https://api.printful.com/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    const fileBody = (await uploaded.json()) as { result?: { url?: string }; error?: { message?: string } };
    if (!uploaded.ok || !fileBody.result?.url) {
      throw new Error(fileBody.error?.message || "Printful could not accept the print file.");
    }

    const confirm = process.env.PRINTFUL_AUTO_CONFIRM !== "false";
    const created = await fetch("https://api.printful.com/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        confirm,
        recipient: {
          name: order.shipping.name,
          address1: order.shipping.address1,
          address2: order.shipping.address2 || undefined,
          city: order.shipping.city,
          state_code: order.shipping.state,
          country_code: order.shipping.country,
          zip: order.shipping.postal,
          email: order.email,
          phone: order.shipping.phone || undefined,
        },
        items: [
          {
            variant_id: variantId(order.formatId, order.sizeId),
            quantity: 1,
            name: `Fingerprint Legacy ${FORMATS[order.formatId].name}`,
            files: [{ url: fileBody.result.url }],
          },
        ],
      }),
    });
    const orderBody = (await created.json()) as {
      result?: { id?: number; status?: string };
      error?: { message?: string };
    };
    if (!created.ok || !orderBody.result?.id) {
      throw new Error(orderBody.error?.message || "Printful could not create the order.");
    }
    return {
      id: String(orderBody.result.id),
      status: orderBody.result.status || (confirm ? "pending" : "draft"),
      mode: "live",
    };
  } catch (error) {
    return {
      id: "",
      status: "error",
      mode: "live",
      error: error instanceof Error ? error.message : "Printful request failed.",
    };
  }
}
