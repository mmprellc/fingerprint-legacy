import type { PrintStyle } from "../fingerprint/types";

function same(a: string[] | undefined, b: string[] | undefined) {
  return (a ?? []).join("\n") === (b ?? []).join("\n");
}

type Freq = "once" | "normal" | "hold";

const FREQ_LABEL: Record<Freq, string> = {
  once: "once",
  normal: "normal",
  hold: "exclude from repeats",
};

export function nameFreq(style: PrintStyle, name: string): Freq {
  if ((style.nameHold ?? []).includes(name)) return "hold";
  if ((style.nameMax ?? []).some((item) => item.name === name && item.max <= 1)) return "once";
  return "normal";
}

/** One line per name whose repeat setting changed, such as "Hanadi: normal to once". */
export function frequencyChanges(before: PrintStyle, after: PrintStyle) {
  const names = [...new Set([...(before.names ?? []), ...(after.names ?? [])])];
  const notes: string[] = [];
  for (const name of names) {
    const had = (before.names ?? []).includes(name);
    const has = (after.names ?? []).includes(name);
    if (had && !has) {
      notes.push(`Removed ${name}.`);
      continue;
    }
    if (!had && has) {
      notes.push(`Added ${name}.`);
      continue;
    }
    const from = nameFreq(before, name);
    const to = nameFreq(after, name);
    if (from !== to) notes.push(`${name}: ${FREQ_LABEL[from]} to ${FREQ_LABEL[to]}`);
  }
  return notes;
}

export function describeStyleChange(before: PrintStyle, after: PrintStyle) {
  const notes: string[] = [];
  if ((before.headerName || "") !== (after.headerName || "") || (before.headerDates || "") !== (after.headerDates || "")) notes.push("Updated the header.");
  if ((before.signature || "") !== (after.signature || "")) notes.push(after.signature ? "Turned the signature on." : "Turned the signature off.");
  if (!same(before.plaqueLines, after.plaqueLines) || before.centerName !== after.centerName || before.secondaryName !== after.secondaryName || before.centerDetail !== after.centerDetail || before.secondaryDetail !== after.secondaryDetail) notes.push("Updated the plaque and dedication ridges.");
  const namesChanged = !same(before.names, after.names);
  const freq = frequencyChanges(before, after);
  if (namesChanged) notes.push("Updated the names.");
  notes.push(...freq.filter((line) => line.includes(" to ")));
  if (!same(before.scriptures, after.scriptures)) notes.push("Updated the verses.");
  if (!same(before.stories, after.stories)) notes.push("Updated the stories.");
  const fillerOf = (style: PrintStyle) => (style.filler === "names" || style.filler === "lines" ? style.filler : "stories");
  if (fillerOf(before) !== fillerOf(after)) notes.push(`Filler is now ${fillerOf(after)}.`);
  if ((before.nameGap || "dot") !== (after.nameGap || "dot")) notes.push(after.nameGap === "space" ? "Names use a word space." : "Names use a centered dot.");
  if (Math.abs((before.textScale || 1) - (after.textScale || 1)) > 0.01) notes.push((after.textScale || 1) < 0.82 ? "Type is the smaller size." : "Type is the standard size.");
  return notes.length ? notes : ["Saved the proof as shown."];
}

const SIZE_LABEL: Record<string, string> = {
  natural: "natural proportion",
  "8x10": "8 x 10 in",
  "11x14": "11 x 14 in",
  "12x16": "12 x 16 in",
  "16x20": "16 x 20 in",
};

export function describeVersionChange(
  before: { style: PrintStyle; sizeId: string },
  after: { style: PrintStyle; sizeId: string },
) {
  const notes = describeStyleChange(before.style, after.style).filter((line) => line !== "Saved the proof as shown.");
  if (before.sizeId !== after.sizeId) {
    notes.push(`Print size: ${SIZE_LABEL[before.sizeId] || before.sizeId} to ${SIZE_LABEL[after.sizeId] || after.sizeId}`);
  }
  return notes.length ? notes : ["No setting changes."];
}
