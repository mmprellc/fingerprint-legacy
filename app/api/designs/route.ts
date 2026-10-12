import { NextResponse } from "next/server";
import { renderArtwork } from "@/lib/fingerprint/render-print";
import type { PreviewPrint } from "@/lib/fingerprint/preview";
import type { PrintStyle, Ridge } from "@/lib/fingerprint/types";
import { productById } from "@/lib/products";
import { newId, saveDesign, savePreview } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    prints?: PreviewPrint[];
    style?: PrintStyle;
    period?: number;
    productId?: string;
    sizeId?: string;
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
  };
  await saveDesign(design);
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
  const names = cleanList(style?.names, 80, 80);
  const scriptures = cleanList(style?.scriptures, 12, 500);
  return {
    font: style?.font === "cormorant" ? "cormorant" : "baskerville",
    preset: String(style?.preset || "charcoal").slice(0, 40),
    textScale: Math.min(1.4, Math.max(0.7, Number(style?.textScale) || 1)),
    title: String(style?.title || "").slice(0, 120),
    script: String(style?.script || "").slice(0, 120),
    ...(cleanLine(style?.footer, 160) ? { footer: cleanLine(style?.footer, 160) } : {}),
    ...(cleanLine(style?.centerName, 80) ? { centerName: cleanLine(style?.centerName, 80) } : {}),
    ...(cleanLine(style?.centerDetail, 80) ? { centerDetail: cleanLine(style?.centerDetail, 80) } : {}),
    ...(cleanLine(style?.secondaryName, 80) ? { secondaryName: cleanLine(style?.secondaryName, 80) } : {}),
    ...(cleanLine(style?.secondaryDetail, 80) ? { secondaryDetail: cleanLine(style?.secondaryDetail, 80) } : {}),
    ...(names ? { names } : {}),
    ...(scriptures ? { scriptures } : {}),
  };
}

function cleanLine(value: string | undefined, max: number) {
  const text = String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  return text;
}

function cleanList(value: string[] | undefined, maxItems: number, maxLen: number) {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => String(item).replace(/[ \t]+/g, " ").trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
  return items.length ? items : undefined;
}
