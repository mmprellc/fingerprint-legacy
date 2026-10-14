import type { PreviewPrint } from "./preview";
import { renderArtwork } from "./render-print";
import type { PrintStyle } from "./types";

/** Glyph portrait on paper. The words are the ridges. The upload is not in the image. */
export async function renderStudioPortrait(prints: PreviewPrint[], style: PrintStyle, period: number) {
  const art = await renderArtwork({
    prints,
    style,
    period,
    preview: true,
  });
  return art.png.toString("base64");
}
