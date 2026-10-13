/** Printful catalog: Enhanced Matte Paper Framed Poster (in), product 2. */

export const FRAMED_POSTER_PRODUCT_ID = 2;

export const frameFinishes = [
  { id: "black", label: "Black", printfulColor: "Black" },
  { id: "white", label: "White", printfulColor: "White" },
  { id: "oak", label: "Natural wood", printfulColor: "Red Oak" },
] as const;

export type FrameFinish = (typeof frameFinishes)[number]["id"];

export const frameSizes = [
  { id: "8x10", label: "8 × 10 in", inches: [8, 10] as [number, number], area: [2400, 3000] as [number, number] },
  { id: "11x14", label: "11 × 14 in", inches: [11, 14] as [number, number], area: [3300, 4200] as [number, number] },
  { id: "16x20", label: "16 × 20 in", inches: [16, 20] as [number, number], area: [4800, 6000] as [number, number] },
] as const;

export type FrameSize = (typeof frameSizes)[number]["id"];

const catalog: Record<FrameFinish, Record<FrameSize, number>> = {
  black: { "8x10": 4651, "11x14": 14292, "16x20": 4399 },
  white: { "8x10": 10754, "11x14": 14293, "16x20": 10753 },
  oak: { "8x10": 15021, "11x14": 15023, "16x20": 15029 },
};

export function isFrameFinish(value: string | undefined): value is FrameFinish {
  return frameFinishes.some((finish) => finish.id === value);
}

export function isFrameSize(value: string | undefined): value is FrameSize {
  return frameSizes.some((size) => size.id === value);
}

export function frameFinishById(id: string | undefined) {
  return frameFinishes.find((finish) => finish.id === id) ?? frameFinishes[0];
}

export function frameSizeById(id: string | undefined) {
  return frameSizes.find((size) => size.id === id) ?? frameSizes[1];
}

/** Catalog variant, unless PRINTFUL_VARIANT_FRAME_<FINISH>_<SIZE> overrides it. */
export function framedVariantId(finish: string | undefined, size: string | undefined) {
  const frame = isFrameFinish(finish) ? finish : "black";
  const chosen = isFrameSize(size) ? size : "11x14";
  const envName = `PRINTFUL_VARIANT_FRAME_${frame.toUpperCase()}_${chosen.toUpperCase()}`;
  const override = Number(process.env[envName] || "");
  return override || catalog[frame][chosen];
}

export function framePrintArea(size: string | undefined) {
  return frameSizeById(size).area;
}
