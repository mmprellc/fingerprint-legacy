import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { renderArtwork } from "@/lib/fingerprint/render-print";
import { recordVersion } from "@/lib/proof/record";
import type { PreviewPrint } from "@/lib/fingerprint/preview";
import { readPrintStyle } from "@/lib/fingerprint/read-style";
import type { PrintStyle, Ridge } from "@/lib/fingerprint/types";
import { productById } from "@/lib/products";
import { isFrameFinish } from "@/lib/frames";
import { HostingConfigError } from "@/lib/runtime";
import { newId, saveDesign, savePreview } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    prints?: PreviewPrint[];
    style?: PrintStyle;
    period?: number;
    productId?: string;
    sizeId?: string;
    frameId?: string;
  } | null;
  const prints = sanitizePrints(body?.prints);
  if (!prints.length) {
    return NextResponse.json({ error: "Add a fingerprint before continuing." }, { status: 400 });
  }
  const style = sanitizeStyle(body?.style);
  const period = Number(body?.period) || 12;
  const product = productById(String(body?.productId || "digital"));
  if (!product.available) {
    return NextResponse.json({ error: "That format is not for sale yet." }, { status: 400 });
  }
  const size = product.sizes.find((item) => item.id === body?.sizeId) ?? product.sizes[0];
  const design = {
    id: newId("dsn"),
    createdAt: new Date().toISOString(),
    prints,
    style,
    period,
    productId: product.id,
    sizeId: size.id,
    shareToken: randomBytes(9).toString("hex"),
    ...(product.id === "framed" && isFrameFinish(body?.frameId) ? { frameId: body.frameId } : {}),
  };
  try {
    await saveDesign(design);
    await recordVersion(design, { style, note: "Uploaded from the studio", changes: ["First proof."] });
  } catch (error) {
    if (error instanceof HostingConfigError) {
      console.error(error.message);
      return NextResponse.json({ error: "The studio cannot save a portrait yet." }, { status: 503 });
    }
    throw error;
  }
  try {
    const preview = await renderArtwork({
      prints,
      style,
      period,
      dpi: 80,
      frame: product.id === "framed",
    });
    await savePreview(design.id, preview.png);
  } catch (error) {
    console.error("preview render failed", error);
  }
  return NextResponse.json({ id: design.id });
}

function sanitizePrints(value: PreviewPrint[] | undefined): PreviewPrint[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2).map((print) => {
    const ridges: Ridge[] = Array.isArray(print.ridges)
      ? print.ridges.slice(0, 400).map((ridge) => ({
          closed: Boolean(ridge.closed),
          length: Number(ridge.length) || 0,
          points: Array.isArray(ridge.points)
            ? ridge.points.slice(0, 2500).map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 }))
            : [],
        })).filter((ridge) => ridge.points.length > 2)
      : [];
    return {
      ridges,
      width: Number(print.width) || 800,
      height: Number(print.height) || 1000,
      lines: Array.isArray(print.lines) ? print.lines.map((line) => String(line).slice(0, 240)).slice(0, 40) : [],
      tx: Number(print.tx) || 0,
      ty: Number(print.ty) || 0,
      rotation: Number(print.rotation) || 0,
      scale: Number(print.scale) || 1,
    };
  }).filter((print) => print.ridges.length > 0);
}

function sanitizeStyle(style: PrintStyle | undefined): PrintStyle {
  return readPrintStyle(style);
}
