import { NextResponse } from "next/server";
import { producePortrait } from "@/lib/fingerprint/pipeline";
import { prepareStudioCapture } from "@/lib/fingerprint/prepare-capture";
import { renderStudioPortrait } from "@/lib/fingerprint/studio-art";
import { hasRidgeWords } from "@/lib/studio-default";
import { readPrintStyle } from "@/lib/fingerprint/read-style";
import { DEFAULT_FONT, DEFAULT_PRESET, type PrintStyle } from "@/lib/fingerprint/types";

export const runtime = "nodejs";
export const maxDuration = 300;

function styleFromForm(raw: string): PrintStyle {
  const fallback: PrintStyle = { font: DEFAULT_FONT, preset: DEFAULT_PRESET, textScale: 1, title: "", script: "" };
  if (!raw) return fallback;
  try {
    return readPrintStyle(JSON.parse(raw) as Partial<PrintStyle>);
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
    const tone = ridges === "dark" || ridges === "light" ? ridges : "auto";
    const style = styleFromForm(String(form.get("style") || ""));
    if (!hasRidgeWords(style)) {
      return NextResponse.json({
        accepted: false,
        portraitPng: "",
        ridges: [],
        warnings: [],
        attempts: [],
        retake: {
          reason: "unmatched",
          title: "Add the words for this print.",
          detail: "The ridges are the words. Add a name and a verse. The sample names are not written onto a photo you upload.",
          steps: [
            "Put the dedication on the center ridges.",
            "Add the names, one per line, and a whole verse.",
            "The portrait is drawn from this photo once those words are here.",
          ],
        },
      });
    }
    const { gray, width, height } = await prepareStudioCapture(input);
    const result = producePortrait(gray, width, height, style, { ridges: tone });
    const round = (value: number) => Math.round(value * 10) / 10;
    const portraitPng = result.accepted
      ? await renderStudioPortrait(
          [{ ridges: result.ridges, width: result.width, height: result.height, lines: [] }],
          { ...style, textScale: result.textScale },
          result.period,
        )
      : "";
    return NextResponse.json({
      accepted: result.accepted,
      width: result.width,
      height: result.height,
      period: result.period,
      ridgesAreDark: result.ridgesAreDark,
      warnings: result.warnings,
      portraitPng,
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
