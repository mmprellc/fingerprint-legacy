import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randyCzyzStyle } from "../lib/pieces";
import type { PrintStyle } from "../lib/fingerprint/types";

const PORT = 3456;
const LIMIT_MS = 30_000;
const PHOTO = path.join(process.cwd(), "public/pieces/randy-source.jpg");

const minimal: PrintStyle = {
  font: "cormorant",
  preset: "ink",
  textScale: 1,
  title: "",
  script: "",
  headerName: "Randy S. Czyz",
  headerDates: "04.20.1955 – 04.20.2026",
  signature: "Fingerprint Legacy",
  plaque: true,
  centerName: "Randy Czyz",
  centerDetail: "4.20.1955",
  secondaryName: "Maryanne Czyz",
  secondaryDetail: "10.17.1955",
  names: ["Jacob Czyz", "Martin Pierce", "Hanadi Czyz", "Adalis Czyz", "Elena Voss"],
  stories: ["He loved the lake.", "The house stayed full."],
};

type Attempt = { profile: string; passed: boolean; failed: string[] };
type Payload = {
  accepted?: boolean;
  error?: string;
  portraitPng?: string;
  ridges?: unknown[];
  retake?: { title?: string; detail?: string } | null;
  attempts?: Attempt[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitForServer(url: string, child: ChildProcess) {
  const deadline = Date.now() + 60_000;
  let last = "starting";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited ${child.exitCode} before it was ready (${last})`);
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
      last = `status ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : "connection refused";
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`next start did not answer on ${url} (${last})`);
}

async function upload(origin: string, style: PrintStyle, label: string) {
  const bytes = fs.readFileSync(PHOTO);
  const body = new FormData();
  body.set("file", new File([bytes], "randy-source.jpg", { type: "image/jpeg" }));
  body.set("ridges", "auto");
  body.set("style", JSON.stringify(style));
  const started = Date.now();
  const response = await fetch(`${origin}/api/studio/extract`, { method: "POST", body });
  const elapsed = Date.now() - started;
  const payload = (await response.json()) as Payload;
  const blob = JSON.stringify(payload.retake ?? {});
  assert(response.ok, `${label} failed ${response.status}: ${payload.error || blob}`);
  assert(payload.accepted, `${label} was rejected: ${payload.retake?.title || ""} ${payload.retake?.detail || ""}`);
  assert(!payload.retake, `${label} returned a retake: ${blob}`);
  assert(!/oval density|could not match this print|retake with the full print/i.test(blob), `${label} surfaced a photo error: ${blob}`);
  assert(elapsed < LIMIT_MS, `${label} took ${elapsed}ms, over ${LIMIT_MS}ms`);
  assert(payload.portraitPng && payload.portraitPng.length > 1000, `${label} did not return a portrait`);
  assert((payload.ridges?.length || 0) >= 80, `${label} returned ${payload.ridges?.length || 0} ridges`);
  assert(payload.attempts?.length === 1, `${label} ran ${payload.attempts?.map((item) => item.profile).join(", ") || "no"} attempts`);
  assert(payload.attempts[0].profile === "locked" && payload.attempts[0].passed, `${label} locked attempt failed: ${payload.attempts[0].failed.join(", ")}`);
  assert(!payload.attempts[0].failed.includes("names"), `${label} dropped names`);
  assert(!payload.attempts[0].failed.includes("coverage"), `${label} failed oval density`);
  console.log(`${label} ok ${elapsed}ms ridges=${payload.ridges?.length} profile=locked`);
}

async function main() {
  if (!fs.existsSync(path.join(process.cwd(), ".next/BUILD_ID"))) {
    throw new Error("Production build is missing. Run next build before this test.");
  }
  if (!fs.existsSync(PHOTO)) throw new Error(`Missing full-print photo at ${PHOTO}`);
  const origin = `http://127.0.0.1:${PORT}`;
  const nextBin = path.join(process.cwd(), "node_modules/.bin/next");
  const child = spawn(nextBin, ["start", "-p", String(PORT), "-H", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(PORT) },
  });
  const stop = () => {
    if (!child.killed) child.kill("SIGTERM");
  };
  process.on("exit", stop);
  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  try {
    await waitForServer(`${origin}/studio`, child);
    await upload(origin, minimal, "minimal");
    await upload(origin, randyCzyzStyle, "randy");
    console.log("studio upload production ok");
  } finally {
    stop();
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve(undefined);
      else child.once("exit", () => resolve(undefined));
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
        resolve(undefined);
      }, 4000);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
