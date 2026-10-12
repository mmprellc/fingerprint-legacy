export const SIZES = {
  "8x10": { id: "8x10", label: "8 × 10 in", widthIn: 8, heightIn: 10 },
  "11x14": { id: "11x14", label: "11 × 14 in", widthIn: 11, heightIn: 14 },
  "16x20": { id: "16x20", label: "16 × 20 in", widthIn: 16, heightIn: 20 },
} as const;

export type SizeId = keyof typeof SIZES;

export const FORMATS = {
  digital: {
    id: "digital",
    name: "The file",
    summary: "A print-ready SVG, PDF, and high-resolution PNG. Yours to keep, reprint, and pass on.",
    ships: false,
    prices: { "8x10": 7900, "11x14": 7900, "16x20": 7900 },
  },
  archival: {
    id: "archival",
    name: "Archival print",
    summary: "Enhanced matte paper, printed and shipped. No frame, so it can be matted the way the room needs.",
    ships: true,
    prices: { "8x10": 14800, "11x14": 18800, "16x20": 24800 },
  },
  framed: {
    id: "framed",
    name: "Framed print",
    summary: "The same matte print, set in a black frame and shipped ready to hang.",
    ships: true,
    prices: { "8x10": 29800, "11x14": 36800, "16x20": 46800 },
  },
} as const;

export type FormatId = keyof typeof FORMATS;

/** Printful catalog variant IDs for enhanced matte posters and black frames. */
export const PRINTFUL_VARIANTS: Record<Exclude<FormatId, "digital">, Record<SizeId, number>> = {
  archival: { "8x10": 4463, "11x14": 14125, "16x20": 3877 },
  framed: { "8x10": 4651, "11x14": 14292, "16x20": 4399 },
};

export const FONTS = [
  { id: "garamond", label: "Garamond", file: "CormorantGaramond-Medium.woff", css: "Cormorant Garamond" },
  { id: "garamond-italic", label: "Italic", file: "CormorantGaramond-MediumItalic.woff", css: "Cormorant Garamond" },
  { id: "cinzel", label: "Inscription", file: "Cinzel-Medium.woff", css: "Cinzel" },
  { id: "eb-garamond", label: "Old style", file: "EBGaramond-Medium.woff", css: "EB Garamond" },
] as const;

export type FontId = (typeof FONTS)[number]["id"];

export const PALETTES = [
  { id: "ivory", name: "Ivory & ink", ink: "#1c1916", background: "#f4efe6", ink2: "#3d342c" },
  { id: "midnight", name: "Midnight", ink: "#f3eadb", background: "#16181d", ink2: "#d7c4a3" },
  { id: "blush", name: "Blush", ink: "#4a2e2c", background: "#f7ebe6", ink2: "#7a4b45" },
  { id: "forest", name: "Forest", ink: "#1d2b24", background: "#e6eee7", ink2: "#3e5648" },
  { id: "navy", name: "Navy & cream", ink: "#1b2740", background: "#f7f1e4", ink2: "#3d4e6e" },
  { id: "gilded", name: "Gilded", ink: "#6a4b2c", background: "#fbf6ee", ink2: "#8c6844" },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];

export function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export function artboardFor(sizeId: SizeId, longEdge = 1600) {
  const size = SIZES[sizeId];
  const width = size.widthIn >= size.heightIn ? longEdge : Math.round((longEdge * size.widthIn) / size.heightIn);
  const height = size.widthIn >= size.heightIn ? Math.round((longEdge * size.heightIn) / size.widthIn) : longEdge;
  return { width, height };
}

export function printPixelWidth(sizeId: SizeId) {
  const dpi = sizeId === "16x20" ? 220 : sizeId === "11x14" ? 260 : 300;
  return SIZES[sizeId].widthIn * dpi;
}

export function fontFile(id: string) {
  return FONTS.find((font) => font.id === id)?.file ?? FONTS[0].file;
}

export const STORIES: Record<string, { label: string; caption: string; prints: { phrases: string[] }[] }> = {
  memorial: {
    label: "Memorial",
    caption: "Margaret Anne Hale  ·  1942 — 2019",
    prints: [
      {
        phrases: [
          "Margaret Anne Hale",
          "1942 — 2019",
          "James, Ruth, and Thomas",
          "Portland · Boise · the house on Alder",
          "She kept the porch light on",
        ],
      },
    ],
  },
  retirement: {
    label: "Retirement",
    caption: "Captain Elena Voss  ·  Engine 14",
    prints: [
      {
        phrases: [
          "Captain Elena Voss",
          "Twenty-six years",
          "Engine 14",
          "The ones she brought home",
          "Courage, quietly",
        ],
      },
    ],
  },
  wedding: {
    label: "Wedding",
    caption: "Daniel & Amelia  ·  June 14",
    prints: [
      { phrases: ["Daniel Cho", "I choose you", "June 14", "The orchard in the rain"] },
      { phrases: ["Amelia Hart", "In this life and the next", "The house we will grow", "Always, Amelia"] },
    ],
  },
  founder: {
    label: "Founder",
    caption: "Since 1998  ·  Make it honest",
    prints: [
      {
        phrases: [
          "The first office on King Street",
          "Twelve people and a long table",
          "Make it honest",
          "Since 1998",
        ],
      },
    ],
  },
};
