import { NextResponse } from "next/server";
import sharp from "sharp";
import { rgbaToGray } from "@/lib/fingerprint/engine";
import { producePortrait } from "@/lib/fingerprint/pipeline";
import { DEFAULT_FONT, DEFAULT_PRESET, type PrintStyle } from "@/lib/fingerprint/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function styleFromForm(raw: string): PrintStyle {
  const fallback: PrintStyle = { font: DEFAULT_FONT, preset: DEFAULT_PRESET, textScale: 1, title: "", script: "" };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<PrintStyle>;
    const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    return {
      ...fallback,
      font: parsed.font === "baskerville" ? "baskerville" : DEFAULT_FONT,
      preset: text(parsed.preset) || fallback.preset,
      textScale: typeof parsed.textScale === "number" && Number.isFinite(parsed.textScale) ? parsed.textScale : 1,
      title: text(parsed.title),
      script: text(parsed.script),
      footer: text(parsed.footer),
      centerName: text(parsed.centerName),
      centerDetail: text(parsed.centerDetail),
      secondaryName: text(parsed.secondaryName),
      secondaryDetail: text(parsed.secondaryDetail),
      names: strings(parsed.names),
      scriptures: strings(parsed.scriptures),
    };
  } catch {
    return fallback;
  }
}

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
    const result = producePortrait(gray, info.width, info.height, styleFromForm(String(form.get("style") || "")), { ridges: tone });
    const round = (value: number) => Math.round(value * 10) / 10;
    return NextResponse.json({
      accepted: result.accepted,
      width: result.width,
      height: result.height,
      period: result.period,
      ridgesAreDark: result.ridgesAreDark,
      warnings: result.warnings,
      textScale: result.textScale,
      retake: result.retake,
      metrics: {
        sharpness: round(result.metrics.sharpness),
        contrast: round(result.metrics.contrast),
        borderInk: round(result.metrics.borderInk),
        fill: round(result.metrics.fill),
      },
      attempts: result.attempts.map((attempt) => ({
        profile: attempt.profile,
        passed: attempt.passed,
        failed: attempt.checks.filter((check) => !check.passed).map((check) => check.id),
      })),
      ridges: result.accepted
        ? result.ridges.map((ridge) => ({
            closed: ridge.closed,
            length: round(ridge.length),
            points: ridge.points.map((point) => ({ x: round(point.x), y: round(point.y) })),
          }))
        : [],
    });
  } catch {
    return NextResponse.json(
      { error: "We could not read that image. Use a JPEG or PNG of the fingerprint." },
      { status: 400 },
    );
  }
}
