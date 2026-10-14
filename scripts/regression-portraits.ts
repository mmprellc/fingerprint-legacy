import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { auditLayout } from "../lib/fingerprint/audit";
import { rgbaToGray } from "../lib/fingerprint/engine";
import { producePortrait, type PortraitResult, type RetakeReason } from "../lib/fingerprint/pipeline";
import { renderArtwork } from "../lib/fingerprint/render-print";
import { synthesizePrint } from "../lib/fingerprint/synthesize";
import { randyCzyzStyle } from "../lib/pieces";
import type { PrintStyle } from "../lib/fingerprint/types";

const sourcePath = path.join(process.cwd(), "public/pieces/randy-source.jpg");
const outDir = "/tmp/fp-regression";

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

type Prepared = { gray: Float32Array; width: number; height: number; png: Buffer };

/** The source files are edge-to-edge. A paper margin keeps the crop gate from reading a full card as cut off. */
async function padPrint(file: string) {
  const padded = await sharp(fs.readFileSync(file))
    .extend({ top: 96, bottom: 96, left: 96, right: 96, background: "#f4f1ea" })
    .jpeg()
    .toBuffer();
  return prepareBuffer(padded);
}

async function prepareBuffer(input: Buffer): Promise<Prepared> {
  const prepared = sharp(input).rotate();
  const meta = await prepared.metadata();
  const long = Math.max(meta.width || 1, meta.height || 1);
  const scale = long > 1600 ? 1600 / long : long < 700 ? 700 / long : 1;
  const pipeline = scale === 1 ? prepared : prepared.resize(Math.round((meta.width || 1) * scale), Math.round((meta.height || 1) * scale), { fit: "fill" });
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    gray: rgbaToGray(data, info.width, info.height),
    width: info.width,
    height: info.height,
    png: await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer(),
  };
}

function grayPng(gray: Float32Array, width: number, height: number) {
  const raw = Buffer.alloc(width * height);
  for (let i = 0; i < gray.length; i++) raw[i] = Math.max(0, Math.min(255, Math.round(gray[i])));
  return sharp(raw, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

function paintArch(width = 880, height = 1180) {
  const gray = new Float32Array(width * height);
  gray.fill(236);
  const cx = width * 0.5;
  const cy = height * 0.78;
  const period = 15;
  const rx = width * 0.4;
  const ry = height * 0.36;
  const stamp = (x: number, y: number) => {
    const radius = 5;
    const x0 = Math.max(0, Math.floor(x - radius));
    const x1 = Math.min(width - 1, Math.ceil(x + radius));
    const y0 = Math.max(0, Math.floor(y - radius));
    const y1 = Math.min(height - 1, Math.ceil(y + radius));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        if (Math.hypot(xx - x, yy - y) > radius) continue;
        const nx = (xx - cx) / rx;
        const ny = (yy - (cy - ry * 0.2)) / ry;
        if (nx * nx + ny * ny > 1) continue;
        const i = yy * width + xx;
        const ink = 46 + Math.hypot(xx - x, yy - y) * 7;
        if (ink < gray[i]) gray[i] = ink;
      }
    }
  };
  for (let band = 2; band <= 22; band++) {
    const radius = 20 + band * period;
    const steps = Math.max(28, Math.round(radius * 1.35));
    for (let step = 0; step <= steps; step++) {
      const angle = Math.PI * (0.14 + 0.72 * (step / steps));
      stamp(cx + Math.cos(angle) * radius, cy - Math.sin(angle) * radius);
    }
  }
  return { gray, width, height };
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function board(photo: Buffer, words: Buffer | null, heading: string, note: string, file: string) {
  const left = await sharp(photo).resize({ width: 520, height: 760, fit: "contain", background: "#F6F1E8" }).png().toBuffer();
  const right = words
    ? await sharp(words).resize({ width: 520, height: 760, fit: "contain", background: "#F6F1E8" }).png().toBuffer()
    : await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="760"><rect width="100%" height="100%" fill="#F6F1E8"/><text x="36" y="80" font-family="Georgia" font-size="26" fill="#34383A">${escapeXml(heading)}</text><text x="36" y="130" font-family="Georgia" font-size="18" fill="#34383A">${escapeXml(note)}</text></svg>`,
        ),
      ).png().toBuffer();
  const label = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="48"><rect width="100%" height="100%" fill="#F6F1E8"/><text x="16" y="32" font-family="Georgia" font-size="20" fill="#34383A">${escapeXml(heading)}</text></svg>`;
  await sharp({ create: { width: 1100, height: 820, channels: 3, background: "#F6F1E8" } })
    .composite([
      { input: Buffer.from(label), left: 0, top: 0 },
      { input: left, left: 16, top: 52 },
      { input: right, left: 560, top: 52 },
    ])
    .png()
    .toFile(file);
}

type Expectation =
  | { kind: "pass"; locked?: boolean }
  | { kind: "retake"; reason: RetakeReason };

async function main() {
  const stroke = auditLayout(`<svg><path d="M0 0" stroke="#111"/></svg>`, shortStyle, 12);
  if (stroke.find((check) => check.id === "no-strokes")?.passed) {
    throw new Error("The stroke check did not catch a drawn line");
  }
  if (!stroke.find((check) => check.id === "letter-case")?.passed) {
    throw new Error(stroke.find((check) => check.id === "letter-case")?.detail || "The letter-case check failed");
  }
  const mixed = auditLayout(
    `<svg><text class="ridge ridge-body" font-size="12.00"><textPath>you</textPath></text><text class="ridge ridge-body" font-size="9.00"><textPath>I</textPath></text></svg>`,
    shortStyle,
    12,
  );
  if (mixed.find((check) => check.id === "uniform-size")?.passed) {
    throw new Error("The size check did not catch two ridge sizes");
  }
  const shouted = auditLayout(
    `<svg><text class="ridge ridge-body" font-size="12"><textPath>YOU</textPath></text></svg>`,
    shortStyle,
    12,
  );
  const caseCheck = shouted.find((check) => check.id === "source-case");
  if (caseCheck?.passed || !caseCheck?.detail.includes("you")) {
    throw new Error(caseCheck?.detail || "The case check did not catch YOU");
  }
  const dotted = auditLayout(
    `<svg><text class="ridge ridge-body" font-size="12"><textPath>·</textPath></text></svg>`,
    shortStyle,
    12,
  );
  if (dotted.find((check) => check.id === "no-fillers")?.passed) {
    throw new Error("The filler check did not catch a divider");
  }
  const fragment = auditLayout(
    `<svg><text class="ridge ridge-body" font-size="12"><textPath>make His face shine</textPath></text></svg>`,
    shortStyle,
    12,
  );
  if (fragment.find((check) => check.id === "min-segment")?.passed) {
    throw new Error("The segment check did not catch a short fragment");
  }
  const chopped = auditLayout(
    `<svg><text class="ridge ridge-body" font-size="12"><textPath>choose you always</textPath></text></svg>`,
    shortStyle,
    12,
  );
  if (chopped.find((check) => check.id === "verse-continuity")?.passed) {
    throw new Error("The verse check did not catch a phrase that starts mid-verse");
  }

  const randy = fs.readFileSync(sourcePath);
  const whorl = synthesizePrint("whorl");
  const arch = paintArch();
  const cases: { id: string; style: PrintStyle; image: Promise<Prepared>; expect: Expectation }[] = [
    { id: "randy", style: randyCzyzStyle, image: prepareBuffer(randy), expect: { kind: "pass", locked: true } },
    {
      id: "randy-rotated",
      style: randyCzyzStyle,
      image: prepareBuffer(await sharp(randy).rotate(16, { background: { r: 244, g: 239, b: 230 } }).jpeg().toBuffer()),
      expect: { kind: "pass" },
    },
    {
      id: "randy-smudged",
      style: randyCzyzStyle,
      image: prepareBuffer(await sharp(randy).blur(1).jpeg().toBuffer()),
      expect: { kind: "pass" },
    },
    {
      id: "randy-low-light",
      style: randyCzyzStyle,
      image: prepareBuffer(await sharp(randy).modulate({ brightness: 0.6 }).jpeg().toBuffer()),
      expect: { kind: "pass" },
    },
    {
      id: "whorl",
      style: shortStyle,
      image: grayPng(whorl.gray, whorl.width, whorl.height).then((png) => prepareBuffer(png)),
      expect: { kind: "pass" },
    },
    {
      id: "arch",
      style: shortStyle,
      image: grayPng(arch.gray, arch.width, arch.height).then((png) => prepareBuffer(png)),
      expect: { kind: "pass" },
    },
    {
      id: "real-whorl",
      style: shortStyle,
      image: padPrint(path.join(process.cwd(), "fixtures/prints/plain-whorl.jpg")),
      expect: { kind: "pass" },
    },
    {
      id: "real-arch",
      style: shortStyle,
      image: padPrint(path.join(process.cwd(), "fixtures/prints/tented-arch.jpg")),
      expect: { kind: "pass" },
    },
    {
      id: "too-blurry",
      style: randyCzyzStyle,
      image: prepareBuffer(await sharp(randy).blur(7).jpeg().toBuffer()),
      expect: { kind: "retake", reason: "blur" },
    },
    {
      id: "low-contrast",
      style: randyCzyzStyle,
      image: prepareBuffer(await sharp(randy).modulate({ brightness: 0.28 }).jpeg().toBuffer()),
      expect: { kind: "retake", reason: "contrast" },
    },
    {
      // Ink that only touches the frame is a warning. This crop cuts through the print, so the portrait checks refuse it.
      id: "cropped",
      style: randyCzyzStyle,
      image: (async () => {
        const meta = await sharp(randy).metadata();
        const width = Math.round((meta.width || 1) * 0.58);
        const height = Math.round((meta.height || 1) * 0.58);
        const left = Math.round(((meta.width || 1) - width) / 2);
        const top = Math.round(((meta.height || 1) - height) / 2);
        return prepareBuffer(await sharp(randy).extract({ left, top, width, height }).jpeg().toBuffer());
      })(),
      expect: { kind: "retake", reason: "unmatched" },
    },
    {
      id: "too-small",
      style: randyCzyzStyle,
      image: (async () => {
        const small = await sharp(randy).resize({ width: 280 }).jpeg().toBuffer();
        const padded = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: "#f7f1e8" } })
          .composite([{ input: small, left: 460, top: 640 }])
          .jpeg()
          .toBuffer();
        return prepareBuffer(padded);
      })(),
      expect: { kind: "retake", reason: "small" },
    },
  ];

  fs.mkdirSync(outDir, { recursive: true });
  const rows: string[] = [];
  let correct = 0;
  for (const item of cases) {
    const image = await item.image;
    const started = Date.now();
    const result = producePortrait(image.gray, image.width, image.height, item.style);
    const ok = judge(item.expect, result);
    if (ok) correct += 1;
    const failed = result.attempts.flatMap((attempt) =>
      attempt.checks.filter((check) => !check.passed).map((check) => `${attempt.profile}:${check.id}`),
    );
    const scored = result.attempts.find((attempt) => attempt.passed) ?? result.attempts[0];
    const fidelity = (scored?.checks ?? [])
      .filter((check) => check.id === "coverage" || check.id === "shape" || check.id === "flow" || check.id === "likeness")
      .map((check) => `${check.id}=${check.detail.replace(/^.*?(\d+%|\d+\.\d+).*/, "$1")}`)
      .join(" ");
    const line = `${ok ? "pass" : "FAIL"} ${item.id} accepted=${result.accepted} profile=${result.attempts.find((attempt) => attempt.passed)?.profile ?? "-"} retake=${result.retake?.reason ?? "-"} sharp=${result.metrics.sharpness.toFixed(1)} contrast=${result.metrics.contrast.toFixed(1)} border=${result.metrics.borderInk.toFixed(2)} fill=${result.metrics.fill.toFixed(2)} ${fidelity} ${failed.join(",")}`;
    rows.push(line);
    console.log(`${line} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    let words: Buffer | null = null;
    if (result.accepted) {
      const art = await renderArtwork({
        prints: [{ ridges: result.ridges, width: result.width, height: result.height, lines: [] }],
        style: { ...item.style, title: "", footer: "", script: "" },
        period: result.period,
        matchSource: true,
      });
      words = art.png;
    }
    const photo = result.width ? await sharp(image.png).resize(result.width, result.height, { fit: "fill" }).png().toBuffer() : image.png;
    const note = result.retake ? result.retake.title : result.accepted ? "Word ridges" : "Not accepted";
    await board(photo, words, `${ok ? "Pass" : "Fail"} · ${item.id}`, note, path.join(outDir, `${item.id}.png`));
  }
  const rate = correct / cases.length;
  const summary = `${correct}/${cases.length} (${Math.round(rate * 100)}%)`;
  console.log(`pass rate ${summary}`);
  fs.writeFileSync(path.join(outDir, "summary.txt"), `${summary}\n${rows.join("\n")}\n`);
  if (correct !== cases.length) process.exit(1);
}

function judge(expect: Expectation, result: PortraitResult) {
  if (expect.kind === "retake") return !result.accepted && result.retake?.reason === expect.reason;
  if (!result.accepted) return false;
  if (expect.locked) return result.attempts[0]?.profile === "locked" && result.attempts[0]?.passed === true && result.attempts.length === 1;
  return true;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
