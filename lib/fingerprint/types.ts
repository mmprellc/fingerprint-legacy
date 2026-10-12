export type Point = { x: number; y: number };

export type RGBA = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type RidgeSet = {
  paths: Point[][];
  width: number;
  height: number;
  spacing: number;
};

export type InvertMode = "auto" | "yes" | "no";

export type ExtractOptions = {
  /** 1 keeps the print's natural ridge spacing. Higher draws finer lines. */
  density?: number;
  invert?: InvertMode;
  /** Longest edge used while tracing. The vectors are resolution-independent after this. */
  maxEdge?: number;
};

export type PrintInput = {
  image: RGBA;
  phrases: string[];
  /** Radians, applied after the print is fitted. Used for intertwined pairs. */
  rotation?: number;
};

export type ArtworkOptions = {
  prints: PrintInput[];
  ink: string;
  ink2?: string;
  background: string;
  caption?: string;
  density?: number;
  /** Extra space between letters, in ems. */
  tracking?: number;
  artboard: { width: number; height: number };
  invert?: InvertMode;
};

export type ArtworkResult = {
  svg: string;
  ridgeCount: number;
  glyphCount: number;
  spacing: number;
};
