import type { PrintStyle } from "../fingerprint/types";

function same(a: string[] | undefined, b: string[] | undefined) {
  return (a ?? []).join("\n") === (b ?? []).join("\n");
}

export function describeStyleChange(before: PrintStyle, after: PrintStyle) {
  const notes: string[] = [];
  if ((before.headerName || "") !== (after.headerName || "") || (before.headerDates || "") !== (after.headerDates || "")) notes.push("Updated the header.");
  if ((before.signature || "") !== (after.signature || "")) notes.push(after.signature ? "Turned the signature on." : "Turned the signature off.");
  if (!same(before.plaqueLines, after.plaqueLines) || before.centerName !== after.centerName || before.secondaryName !== after.secondaryName) notes.push("Updated the plaque and dedication ridges.");
  if (!same(before.names, after.names) || JSON.stringify(before.nameMax ?? []) !== JSON.stringify(after.nameMax ?? []) || !same(before.nameHold, after.nameHold)) notes.push("Updated the names.");
  if (!same(before.scriptures, after.scriptures)) notes.push("Updated the verses.");
  if (!same(before.stories, after.stories)) notes.push("Updated the stories.");
  if ((before.filler || "") !== (after.filler || "")) notes.push(`Filler is now ${after.filler || "stories"}.`);
  if ((before.nameGap || "dot") !== (after.nameGap || "dot")) notes.push(after.nameGap === "space" ? "Names use a word space." : "Names use a centered dot.");
  if (Math.abs((before.textScale || 1) - (after.textScale || 1)) > 0.01) notes.push((after.textScale || 1) < 0.82 ? "Type is the smaller size." : "Type is the standard size.");
  return notes.length ? notes : ["Saved the proof as shown."];
}
