import type { PrintStyle } from "./fingerprint/types";

/** Words the studio uses until the customer replaces them. A whole verse plus names, so the oval fills. */
export const studioRidgeStyle = {
  centerName: "Margaret Hale",
  centerDetail: "1942",
  secondaryName: "James Hale",
  secondaryDetail: "the yellow house",
  names: ["Margaret Hale", "James Hale", "Elise Hale", "Elena Voss", "Jonah Ellis"],
  scriptures: ["The Lord bless you and keep you; the Lord make His face shine upon you, and give you peace."],
} satisfies Pick<PrintStyle, "centerName" | "centerDetail" | "secondaryName" | "secondaryDetail" | "names" | "scriptures">;

export function hasRidgeWords(style: PrintStyle) {
  return Boolean(style.names?.some((item) => item.trim()) || style.scriptures?.some((item) => item.trim()));
}

/** Coverage is measured on the words, not the bare photo. An empty form still has to draw a portrait. */
export function ensureRidgeWords(style: PrintStyle): PrintStyle {
  if (hasRidgeWords(style)) return style;
  return { ...style, ...studioRidgeStyle };
}
