import type { PrintStyle } from "./fingerprint/types";

/** Spelled exactly as given, including the repeated names. */
export const RANDY_CZYZ_NAMES = [
  "Randy Czyz",
  "Maryanne Czyz",
  "Jeremy Czyz",
  "Jacob Czyz",
  "Thomas Czyz",
  "Michelle Pierce",
  "Jill Czyz",
  "Maria Czyz",
  "Martin Pierce",
  "Bailey Czyz",
  "Noah Czyz",
  "Joseph Czyz",
  "Madelyn Czyz",
  "Isaiah Czyz",
  "Sean Czyz",
  "McKenzie Czyz",
  "Jacob Czyz",
  "Gabriella Pierce",
  "Martin Pierce",
  "Adalis Czyz",
  "Addison Pierce",
  "William Czyz",
  "Elizabeth Pierce",
  "Ainsley Pierce",
  "Emilee Czyz",
  "Kathryn Czyz",
  "Kylie Czyz",
  "Hanadi Czyz",
  "Jackson Czyz",
];

export const RANDY_CZYZ_SCRIPTURES = [
  "“Do not fear, for I am with you; do not be afraid, for I am your God. I will strengthen you; I will help you; I will hold on to you with My righteous right hand.” — Isaiah 41:10",
  "“My flesh and my heart may fail, but God is the strength of my heart and my portion forever.” — Psalm 73:26",
  "“Your word is a lamp to my feet and a light to my path.” — Psalm 119:105",
  "“The Lord bless you and keep you; The Lord make His face shine upon you, and be gracious to you; The Lord lift up His countenance upon you, and give you peace.” — Numbers 6:24–26",
];

export const randyCzyzStyle: PrintStyle = {
  font: "baskerville",
  preset: "charcoal",
  textScale: 1,
  title: "Randy Czyz Fingerprint Legacy",
  script: "",
  footer: "Randy Czyz — 4.20.1955",
  centerName: "Randy Czyz",
  centerDetail: "4.20.1955",
  secondaryName: "Maryanne Czyz",
  secondaryDetail: "10.17.1955",
  names: RANDY_CZYZ_NAMES,
  scriptures: RANDY_CZYZ_SCRIPTURES,
};

export type StudioPiece = {
  slug: string;
  sample: "loop" | "whorl";
  style: PrintStyle;
};

export const studioPieces: StudioPiece[] = [
  { slug: "randy-czyz", sample: "loop", style: randyCzyzStyle },
];

export function pieceBySlug(slug: string) {
  return studioPieces.find((piece) => piece.slug === slug);
}
