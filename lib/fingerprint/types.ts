export type Pt = { x: number; y: number };

export type Ridge = {
  points: Pt[];
  closed: boolean;
  length: number;
};

/** Locked knobs for one extraction attempt. Defaults are the Randy print. */
export type ExtractProfile = {
  /** Ink is this far from the paper tone. */
  inkDelta?: number;
  /** A ridge this close to a neighbor, as a fraction of the period, is dropped. */
  spacingLimit?: number;
  spacingHard?: number;
  /** Ridge spacing as a multiple of the measured period. */
  sepFactor?: number;
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
  profile?: ExtractProfile;
  /** Keep the silhouette mask for the quality gate. It is not sent to the browser. */
  keepMask?: boolean;
};

export type ExtractDebug = {
  normalized: Float32Array;
  enhanced: Float32Array;
  binary: Uint8Array;
  skeleton: Uint8Array;
  orient?: Float32Array;
  coherence?: Float32Array;
};

export type ExtractResult = {
  width: number;
  height: number;
  period: number;
  ridges: Ridge[];
  warnings: string[];
  ridgesAreDark: boolean;
  /** Present only when keepMask was set. Not sent to the browser. */
  mask?: Uint8Array;
  /** Working photo, same grid as `mask`. */
  gray?: Float32Array;
  /** Ridge direction in radians, same grid as `mask`. */
  orient?: Float32Array;
  /** 0–1 confidence of `orient`. */
  coherence?: Float32Array;
  debug?: ExtractDebug;
};

export type InkPreset = {
  id: string;
  label: string;
  ink: string;
  paper: string;
};

export const INK_PRESETS: InkPreset[] = [
  { id: "ink", label: "Black", ink: "#111111", paper: "#FFFFFF" },
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
  /** Legacy piece title. Unused when `headerName` is set. */
  title: string;
  /** Legacy script accent. Used as the footer when `footer` is empty and there is no signature. */
  script: string;
  /** Line under the portrait. */
  footer?: string;
  /** Person's name, larger and bold, above the portrait. */
  headerName?: string;
  /** Birth and death, under the header name. */
  headerDates?: string;
  /** Small script signature, bottom right. */
  signature?: string;
  /** Blank a plaque in the core instead of setting the dedications on ridges. */
  plaque?: boolean;
  /** Plaque lines, in order. When empty, the center, marriage, and secondary fields are used. */
  plaqueLines?: string[];
  /** Primary dedication. On the core ridges, or the first plaque lines. */
  centerName?: string;
  centerDetail?: string;
  /** Second dedication, on the next ridge out, or the next plaque lines. */
  secondaryName?: string;
  secondaryDetail?: string;
  /** Marriage line on the plaque, under the two names. */
  marriage?: string;
  marriageDate?: string;
  /** Names along the ridges, one phrase each. Spelled as given. */
  names?: string[];
  /** Whole verses, in order. A long verse continues onto the next ridges. */
  scriptures?: string[];
  /** Whole paragraphs placed after the names and verses. A paragraph that does not fit is left off. */
  stories?: string[];
};

export const FONTS: { id: RidgeFontId; label: string; file: string; family: string; charRatio: number; capEm: number }[] = [
  {
    id: "cormorant",
    label: "Cormorant",
    file: "CormorantGaramond-Regular.ttf",
    family: "Cormorant Garamond",
    charRatio: 0.4,
    capEm: 0.625,
  },
  {
    id: "baskerville",
    label: "Baskerville",
    file: "LibreBaskerville-Regular.ttf",
    family: "Libre Baskerville",
    charRatio: 0.52,
    capEm: 0.77,
  },
];

/** The portrait defaults to the black-on-white piece: a thin serif, one small size, dense even rows. */
export const DEFAULT_FONT: RidgeFontId = "cormorant";
export const DEFAULT_PRESET = "ink";
