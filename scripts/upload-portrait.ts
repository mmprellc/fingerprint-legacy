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
type Payload = {
  accepted?: boolean;
  error?: string;
  portraitPng?: string;
  ridges?: unknown[];
  warnings?: string[];
  retake?: { reason?: string; title?: string } | null;
  metrics?: { borderInk?: number };
  attempts?: Attempt[];
};

async function upload(file: string, style: PrintStyle, name: string) {
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

async function main() {
  const bare: PrintStyle = { font: "cormorant", preset: "ink", textScale: 1, title: "", script: "Always with you." };
  await upload(path.join(process.cwd(), "public/pieces/randy-source.jpg"), bare, "randy-empty-form");
  await upload(path.join(process.cwd(), "fixtures/prints/plain-whorl.jpg"), shortStyle, "plain-whorl");
  await upload(path.join(process.cwd(), "public/pieces/randy-source.jpg"), randyCzyzStyle, "randy-source");
  console.log("upload portrait ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
