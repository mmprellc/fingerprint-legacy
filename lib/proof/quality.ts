import { auditLayout } from "../fingerprint/audit";
import { countCrossings } from "../fingerprint/geometry";
import { buildPreviewSvg, type PreviewPrint } from "../fingerprint/preview";
import type { PrintStyle } from "../fingerprint/types";

const PLAIN: Record<string, string> = {
  "no-strokes": "Some ridges are drawn lines instead of words.",
  legible: "The type is smaller than a person can read on the ridges.",
  "dedication-core": "The center plaque and the dedication ridges are out of step.",
  verses: "A verse is broken or out of order.",
  names: "A name from the list is missing on the ridges.",
  "name-balance": "One name is repeated much more often than the others.",
  "uniform-size": "The ridge type is not one even size.",
  "source-case": "A word changed capitalization from what you typed.",
  "letter-case": "Capitals and lowercase are not sitting on one baseline.",
  "no-fillers": "A short ridge was filled with dots.",
  "min-segment": "A line of type was cut shorter than a full phrase.",
  "verse-continuity": "A verse does not continue cleanly onto the next ridge.",
};

/** Plain-English warnings for the customer. An empty list means the proof looks sound. */
export function proofWarnings(prints: PreviewPrint[], style: PrintStyle, period: number) {
  const warnings: string[] = [];
  const ridges = prints[0]?.ridges ?? [];
  if (ridges.length < 8) warnings.push("The fingertip silhouette did not yield enough ridges to hold a portrait.");
  const crossings = countCrossings(ridges.map((ridge) => ({ points: ridge.points })));
  if (crossings > 0) warnings.push(`Ridge paths cross ${crossings} ${crossings === 1 ? "time" : "times"}. Words should sit on ridges that do not cross.`);
  try {
    const preview = buildPreviewSvg(prints, style, period);
    for (const check of auditLayout(preview.svg, style, period)) {
      if (check.passed) continue;
      warnings.push(PLAIN[check.id] || check.detail);
    }
  } catch {
    warnings.push("The proof could not be checked. Try the revision again.");
  }
  if (warnings.length === 0) warnings.push("No cut-off words, no crossed ridges, one type size, and the silhouette is intact.");
  return warnings;
}
