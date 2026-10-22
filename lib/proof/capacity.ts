import { metricsWidth } from "../fingerprint/font-metrics";
import { bodyTrackingEm, bodyWordGapEm, fontSizeFor } from "../fingerprint/lettering";
import { fontById } from "../fingerprint/preview";
import type { PrintStyle, Ridge } from "../fingerprint/types";

function wordsIn(value: string | undefined) {
  return (value ?? "").split(/\s+/).filter(Boolean).length;
}

/** Unique content, counted once: header, plaque, dedications, names, verses, and stories. */
export function contentWords(style: PrintStyle) {
  const chunks = [
    style.headerName,
    style.headerDates,
    style.signature,
    ...(style.plaqueLines ?? []),
    style.centerName,
    style.centerDetail,
    style.secondaryName,
    style.secondaryDetail,
    style.marriage,
    style.marriageDate,
    ...(style.names ?? []),
    ...(style.scriptures ?? []),
    ...(style.stories ?? []),
  ];
  return chunks.reduce((sum, item) => sum + wordsIn(item), 0);
}

/** Words that fit on the ridges at about 95% of their length, at this body size. */
export function ridgeCapacity(ridges: Ridge[], period: number, textScale: number) {
  const font = fontById("cormorant");
  const size = fontSizeFor(period, textScale || 1, font.capEm);
  const gap = size * bodyWordGapEm(textScale);
  const tracking = -size * bodyTrackingEm(textScale);
  const sample = metricsWidth(font.file, "family", size, tracking, gap);
  const pitch = Math.max(8, sample + gap);
  let length = 0;
  for (const ridge of ridges) {
    const run = ridge.length || 0;
    length += run;
  }
  return Math.max(1, Math.round((length * 0.95) / pitch));
}

export function capacityLine(used: number, capacity: number, sizeLabel?: string) {
  const place = sizeLabel ? ` at ${sizeLabel}` : "";
  const more = capacity - used;
  if (more > 0) return `Uses ${used} of ~${capacity.toLocaleString("en-US")} words${place}. Add ~${more.toLocaleString("en-US")} more to avoid repeats.`;
  return `Uses ${used} of ~${capacity.toLocaleString("en-US")} words${place}. The ridges repeat content to fill the print.`;
}
