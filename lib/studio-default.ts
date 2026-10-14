import type { PrintStyle } from "./fingerprint/types";

/** Words the sample portrait uses until someone replaces them. Not applied to a photo the customer uploads. */
export const studioRidgeStyle = {
  centerName: "Margaret Hale",
  centerDetail: "1942",
  secondaryName: "James Hale",
  secondaryDetail: "the yellow house",
  names: ["Margaret Hale", "James Hale", "Elise Hale", "Elena Voss", "Jonah Ellis"],
  scriptures: ["The Lord bless you and keep you; the Lord make His face shine upon you, and give you peace."],
} satisfies Pick<PrintStyle, "centerName" | "centerDetail" | "secondaryName" | "secondaryDetail" | "names" | "scriptures">;

function cleanList(values: string[] | undefined) {
  return (values ?? []).map((item) => item.trim()).filter(Boolean);
}

export function hasRidgeWords(style: Pick<PrintStyle, "names" | "scriptures">) {
  return Boolean(cleanList(style.names).length || cleanList(style.scriptures).length);
}

/** Enough of the customer's own words to letter a portrait, so a single keystroke does not start the extract. */
export function hasDrawableWords(style: Pick<PrintStyle, "names" | "scriptures">) {
  const names = cleanList(style.names);
  const words = cleanList(style.scriptures).reduce((sum, verse) => sum + verse.split(/\s+/).filter(Boolean).length, 0);
  return words >= 4 || names.length >= 3;
}

/** True when the form still holds the sample family, unchanged. */
export function isSampleRidgeStyle(style: PrintStyle) {
  return (
    (style.centerName ?? "").trim() === studioRidgeStyle.centerName &&
    (style.centerDetail ?? "").trim() === studioRidgeStyle.centerDetail &&
    (style.secondaryName ?? "").trim() === studioRidgeStyle.secondaryName &&
    (style.secondaryDetail ?? "").trim() === studioRidgeStyle.secondaryDetail &&
    cleanList(style.names).join("\n") === studioRidgeStyle.names.join("\n") &&
    cleanList(style.scriptures).join("\n") === studioRidgeStyle.scriptures.join("\n")
  );
}

/** Drop the sample family so an uploaded print is lettered with the customer's own words. */
export function clearSampleRidgeStyle(style: PrintStyle): PrintStyle {
  if (!isSampleRidgeStyle(style)) return style;
  return {
    ...style,
    centerName: "",
    centerDetail: "",
    secondaryName: "",
    secondaryDetail: "",
    names: [],
    scriptures: [],
  };
}
