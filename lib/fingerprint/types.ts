export type Pt = { x: number; y: number };

export type Ridge = {
  points: Pt[];
  closed: boolean;
  length: number;
};

export type ExtractOptions = {
  /** dark: ridges are darker than the paper. light: the reverse. auto: detect. */
  ridges?: "auto" | "dark" | "light";
  /** Desired ridge period in working pixels. */
  targetPeriod?: number;
  /** Longest side of the working image. */
  maxSide?: number;
  /** When false, skip scale normalization (used by the ground-truth test). */
  rescale?: boolean;
  debug?: boolean;
};

export type ExtractDebug = {
  normalized: Float32Array;
  enhanced: Float32Array;
  binary: Uint8Array;
  skeleton: Uint8Array;
};

export type ExtractResult = {
  width: number;
  height: number;
  period: number;
  ridges: Ridge[];
  warnings: string[];
  ridgesAreDark: boolean;
  debug?: ExtractDebug;
};

export type InkPreset = {
  id: string;
  label: string;
  ink: string;
  paper: string;
};

export const INK_PRESETS: InkPreset[] = [
  { id: "charcoal", label: "Charcoal", ink: "#34383A", paper: "#F6F1E8" },
  { id: "gold", label: "Antique gold", ink: "#8C7344", paper: "#F6F1E8" },
  { id: "slate", label: "Slate", ink: "#66798A", paper: "#F6F1E8" },
  { id: "sage", label: "Sage", ink: "#5E6B58", paper: "#F6F1E8" },
  { id: "ivory-night", label: "Ivory on charcoal", ink: "#F6F1E8", paper: "#34383A" },
];

export type RidgeFontId = "baskerville" | "cormorant";

export type PrintStyle = {
  font: RidgeFontId;
  preset: string;
  textScale: number;
  /** Piece title, set above the portrait. */
  title: string;
  /** Legacy script accent. Used as the footer when `footer` is empty. */
  script: string;
  /** Line under the portrait. */
  footer?: string;
  /** Primary dedication, set in the core. */
  centerName?: string;
  centerDetail?: string;
  /** Second dedication, set just under the core. */
  secondaryName?: string;
  secondaryDetail?: string;
  /** Names repeated along the ridges, one phrase each. Spelled as given. */
  names?: string[];
  /** Verses repeated along the ridges, in order. */
  scriptures?: string[];
};

export const FONTS: { id: RidgeFontId; label: string; file: string; family: string; charRatio: number }[] = [
  {
    id: "baskerville",
    label: "Baskerville",
    file: "LibreBaskerville-Bold.ttf",
    family: "Libre Baskerville",
    charRatio: 0.56,
  },
  {
    id: "cormorant",
    label: "Cormorant",
    file: "CormorantGaramond-SemiBold.ttf",
    family: "Cormorant Garamond",
    charRatio: 0.42,
  },
];
