import fs from "node:fs";
import path from "node:path";
import { parse, type Font } from "opentype.js";
import { fontFile } from "../catalog";

const cache = new Map<string, Font>();

export function loadTypefaceSync(fontId: string): Font {
  const hit = cache.get(fontId);
  if (hit) return hit;
  const file = path.join(process.cwd(), "public", "fonts", fontFile(fontId));
  const buf = fs.readFileSync(file);
  const font = parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  cache.set(fontId, font);
  return font;
}
