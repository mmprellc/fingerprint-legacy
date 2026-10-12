import { NextResponse } from "next/server";
import sharp from "sharp";
import { extractFromGray, rgbaToGray } from "@/lib/fingerprint/engine";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const ridges = String(form.get("ridges") || "auto");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a fingerprint photo first." }, { status: 400 });
  }
  if (file.size > 12_000_000) {
    return NextResponse.json({ error: "That photo is larger than 12 MB. Try a smaller one." }, { status: 400 });
  }
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const prepared = sharp(input).rotate();
    const meta = await prepared.metadata();
    if (!meta.width || !meta.height) throw new Error("unreadable");
    const long = Math.max(meta.width, meta.height);
    const scale = long > 1600 ? 1600 / long : long < 700 ? 700 / long : 1;
    const pipeline = scale === 1 ? prepared : prepared.resize(Math.round(meta.width * scale), Math.round(meta.height * scale), { fit: "fill" });
    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const gray = rgbaToGray(data, info.width, info.height);
    const tone = ridges === "dark" || ridges === "light" ? ridges : "auto";
    const result = extractFromGray(gray, info.width, info.height, { ridges: tone });
    return NextResponse.json({
      width: result.width,
      height: result.height,
      period: result.period,
      ridgesAreDark: result.ridgesAreDark,
      warnings: result.warnings,
      ridges: result.ridges.map((ridge) => ({
        closed: ridge.closed,
        length: Math.round(ridge.length * 10) / 10,
        points: ridge.points.map((point) => ({
          x: Math.round(point.x * 10) / 10,
          y: Math.round(point.y * 10) / 10,
        })),
      })),
    });
  } catch {
    return NextResponse.json(
      { error: "We could not read that image. Use a JPEG or PNG of the fingerprint." },
      { status: 400 },
    );
  }
}
