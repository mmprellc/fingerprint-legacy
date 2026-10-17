import { NextResponse } from "next/server";
import type { PreviewPrint } from "@/lib/fingerprint/preview";
import { readPrintStyle } from "@/lib/fingerprint/read-style";
import { renderStudioPortrait } from "@/lib/fingerprint/studio-art";
import type { PrintStyle, Ridge } from "@/lib/fingerprint/types";
export const runtime = "nodejs";
export const maxDuration = 300;

function sanitize(value: unknown): PreviewPrint[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2).map((print) => {
    const item = print as Partial<PreviewPrint>;
    const ridges: Ridge[] = Array.isArray(item.ridges)
      ? item.ridges.slice(0, 400).map((ridge) => ({
          closed: Boolean(ridge.closed),
          length: Number(ridge.length) || 0,
          points: Array.isArray(ridge.points)
            ? ridge.points.slice(0, 2500).map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 }))
            : [],
        })).filter((ridge) => ridge.points.length > 2)
      : [];
    return {
      ridges,
      width: Number(item.width) || 1,
      height: Number(item.height) || 1,
      lines: Array.isArray(item.lines) ? item.lines.filter((line): line is string => typeof line === "string").slice(0, 80) : [],
      tx: Number(item.tx) || 0,
      ty: Number(item.ty) || 0,
      rotation: Number(item.rotation) || 0,
      scale: Number(item.scale) || 1,
    };
  }).filter((print) => print.ridges.length > 0);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { prints?: unknown; style?: PrintStyle; period?: number } | null;
  const prints = sanitize(body?.prints);
  if (!prints.length) {
    return NextResponse.json({ error: "No ridges to draw." }, { status: 400 });
  }
  const style = readPrintStyle(body?.style);
  try {
    const portraitPng = await renderStudioPortrait(prints, style, Number(body?.period) || 12);
    return NextResponse.json({ portraitPng });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The portrait could not be drawn.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
