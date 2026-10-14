import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { POST } from "../app/api/studio/extract/route";
import { randyCzyzStyle } from "../lib/pieces";
import type { PrintStyle } from "../lib/fingerprint/types";

const shortStyle: PrintStyle = {
  font: "cormorant",
  preset: "ink",
  textScale: 1,
  title: "",
  script: "",
  centerName: "Elena Voss",
  centerDetail: "June 14",
  secondaryName: "Jonah Ellis",
  secondaryDetail: "the orchard",
  names: ["Margaret Hale", "James Hale", "Elise Hale", "Elena Voss", "Jonah Ellis"],
  scriptures: ["I choose you always"],
};

type Attempt = { profile: string; passed: boolean; failed: string[] };
type Ridge = { points: { x: number; y: number }[] };
type Payload = {
  accepted?: boolean;
  error?: string;
  portraitPng?: string;
  width?: number;
  height?: number;
  ridges?: Ridge[];
  warnings?: string[];
  retake?: { reason?: string; title?: string; detail?: string } | null;
  metrics?: { borderInk?: number };
  attempts?: Attempt[];
};

/** Paper-texture lines are long, nearly horizontal, and sit above the fingertip. */
function flatTopRidges(ridges: Ridge[], width: number, height: number) {
  let count = 0;
  for (const ridge of ridges) {
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    for (const point of ridge.points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    const wide = maxX - minX > width * 0.45;
    const flat = maxY - minY < 14;
    if (wide && flat && minY < height * 0.2) count += 1;
  }
  return count;
}

function spanOf(ridges: Ridge[], width: number, height: number) {
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;
  for (const ridge of ridges) {
    for (const point of ridge.points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }
  return {
    fracW: (maxX - minX) / width,
    fracH: (maxY - minY) / height,
    minY,
    maxY,
  };
}

async function upload(file: string, style: PrintStyle, name: string, silhouette = false) {
  const bytes = fs.readFileSync(file);
  const body = new FormData();
  body.set("file", new File([bytes], path.basename(file), { type: "image/jpeg" }));
  body.set("ridges", "auto");
  body.set("style", JSON.stringify(style));
  const response = await POST(new Request("http://localhost/api/studio/extract", { method: "POST", body }));
  const payload = (await response.json()) as Payload;
  if (!response.ok) throw new Error(`${name} failed ${response.status}: ${payload.error || "no error"}`);
  if (!payload.accepted) {
    throw new Error(`${name} was rejected (${payload.retake?.reason || "none"}): ${payload.retake?.title || ""}`);
  }
  if (payload.retake?.reason === "crop") throw new Error(`${name} is still hard-rejected for touching the edge`);
  const passed = payload.attempts?.find((attempt) => attempt.passed);
  if (!passed) throw new Error(`${name} did not pass the pipeline: ${JSON.stringify(payload.attempts)}`);
  if (passed.failed.length) throw new Error(`${name} passed profile still lists ${passed.failed.join(",")}`);
  if (!payload.portraitPng) throw new Error(`${name} did not return the glyph portrait`);
  if ((payload.ridges?.length || 0) < 8) throw new Error(`${name} returned too few ridges`);
  if (silhouette) {
    const passedLocked = payload.attempts?.[0];
    if (passedLocked?.profile !== "locked" || !passedLocked.passed || (payload.attempts?.length || 0) !== 1) {
      throw new Error(`${name} did not pass on the locked profile: ${JSON.stringify(payload.attempts)}`);
    }
    const width = payload.width || 1;
    const height = payload.height || 1;
    const span = spanOf(payload.ridges || [], width, height);
    const flat = flatTopRidges(payload.ridges || [], width, height);
    fs.writeFileSync("/tmp/randy-route-portrait.png", Buffer.from(payload.portraitPng || "", "base64"));
    console.log(`${name} silhouette ridges=${payload.ridges?.length} span=${span.fracW.toFixed(2)}x${span.fracH.toFixed(2)} flatTop=${flat}`);
    // The padded route read the card as ridges: 132 of them, including flat lines across the top.
    if ((payload.ridges?.length || 0) > 115) {
      throw new Error(`${name} has ${payload.ridges?.length} ridges; the locked silhouette is near 96`);
    }
    if (span.fracW > 0.98 || span.fracH > 0.98) {
      throw new Error(`${name} fills the frame (${span.fracW.toFixed(2)} x ${span.fracH.toFixed(2)}) instead of the fingertip`);
    }
    if (flat > 0) throw new Error(`${name} has ${flat} flat ridges in the top margin`);
  }
  const png = Buffer.from(payload.portraitPng, "base64");
  if (png.equals(bytes)) throw new Error(`${name} returned the uploaded photo`);
  const meta = await sharp(png).metadata();
  if ((meta.width || 0) < 200 || meta.format !== "png") throw new Error(`${name} portrait is not a png`);
  const raw = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const corner = [raw.data[0], raw.data[1], raw.data[2]];
  if (corner.some((channel) => channel < 200)) {
    throw new Error(`${name} portrait corner is not paper (${corner.join(",")})`);
  }
  let dark = 0;
  const step = raw.info.channels * 12;
  for (let i = 0; i < raw.data.length; i += step) {
    if (raw.data[i] < 70 && raw.data[i + 1] < 70 && raw.data[i + 2] < 70) dark += 1;
  }
  if (dark < 40) throw new Error(`${name} portrait has no word-ridge ink`);
  console.log(
    `${name} ok profile=${passed.profile} ridges=${payload.ridges?.length} border=${payload.metrics?.borderInk} portrait=${meta.width}x${meta.height} ink=${dark} warnings=${(payload.warnings || []).join(" | ") || "none"}`,
  );
}

async function emptyForm(file: string) {
  const bare: PrintStyle = { font: "cormorant", preset: "ink", textScale: 1, title: "", script: "Always with you." };
  const started = Date.now();
  const bytes = fs.readFileSync(file);
  const body = new FormData();
  body.set("file", new File([bytes], "randy-source.jpg", { type: "image/jpeg" }));
  body.set("ridges", "auto");
  body.set("style", JSON.stringify(bare));
  const response = await POST(new Request("http://localhost/api/studio/extract", { method: "POST", body }));
  const payload = (await response.json()) as Payload;
  const elapsed = Date.now() - started;
  if (!response.ok) throw new Error(`randy-empty-form failed ${response.status}: ${payload.error || "no error"}`);
  if (payload.accepted || payload.portraitPng) throw new Error("randy-empty-form was lettered without the customer's words");
  if (!payload.retake?.title?.toLowerCase().includes("word")) {
    throw new Error(`randy-empty-form retake was ${payload.retake?.title || "missing"}`);
  }
  const blob = JSON.stringify(payload);
  if (/Margaret Hale|James Hale|yellow house/.test(blob)) throw new Error("randy-empty-form put the sample family back");
  if (elapsed > 8_000) throw new Error(`randy-empty-form ran the portrait pipeline (${elapsed}ms)`);
  console.log(`randy-empty-form ok ${elapsed}ms`);
}

async function main() {
  await emptyForm(path.join(process.cwd(), "public/pieces/randy-source.jpg"));
  await upload(path.join(process.cwd(), "fixtures/prints/plain-whorl.jpg"), shortStyle, "plain-whorl");
  await upload(path.join(process.cwd(), "public/pieces/randy-source.jpg"), randyCzyzStyle, "randy-source", true);
  console.log("upload portrait ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
