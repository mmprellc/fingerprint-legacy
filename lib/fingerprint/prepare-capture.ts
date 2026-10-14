import sharp from "sharp";
import { rgbaToGray } from "./engine";
import { measureCapture, needsPaperMargin } from "./pipeline";

/** Same long-edge fit as the locked Randy extract. */
async function scaledGray(input: Buffer) {
  const prepared = sharp(input).rotate();
  const meta = await prepared.metadata();
  if (!meta.width || !meta.height) throw new Error("unreadable");
  const long = Math.max(meta.width, meta.height);
  const scale = long > 1600 ? 1600 / long : long < 700 ? 700 / long : 1;
  const pipeline = scale === 1 ? prepared : prepared.resize(Math.round(meta.width * scale), Math.round(meta.height * scale), { fit: "fill" });
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { gray: rgbaToGray(data, info.width, info.height), width: info.width, height: info.height };
}

/**
 * The locked studio extract. A print that already has a paper margin is not padded:
 * padding shifts the paper tone and the ink mask then reads card texture as ridges.
 * An edge-to-edge card gets the same 96px paper margin the regression uses, then the same scale.
 */
export async function prepareStudioCapture(input: Buffer) {
  const fitted = await scaledGray(input);
  if (!needsPaperMargin(measureCapture(fitted.gray, fitted.width, fitted.height))) return fitted;
  const padded = await sharp(input)
    .rotate()
    .extend({ top: 96, bottom: 96, left: 96, right: 96, background: "#f4f1ea" })
    .toBuffer();
  return scaledGray(padded);
}
