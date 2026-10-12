import { parse, type Font } from "opentype.js";
import { fontFile } from "../catalog";

const cache = new Map<string, Promise<Font>>();

/** Browser-safe loader. The same files are read from disk on the server. */
export function loadTypeface(fontId: string): Promise<Font> {
  const existing = cache.get(fontId);
  if (existing) return existing;
  const pending = fetch(`/fonts/${fontFile(fontId)}`)
    .then((response) => {
      if (!response.ok) throw new Error("The typeface could not be loaded.");
      return response.arrayBuffer();
    })
    .then((buffer) => parse(buffer));
  cache.set(fontId, pending);
  return pending;
}
