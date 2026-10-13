import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { putBytes, signedFileUrl } from "@/lib/files";
import { isFrameFinish, isFrameSize } from "@/lib/frames";
import { createFramedMockup, pollMockup } from "@/lib/printful-mockup";
import { HostingConfigError } from "@/lib/runtime";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const taskKey = new URL(request.url).searchParams.get("task") || "";
  const result = await pollMockup(taskKey);
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  if (!process.env.PRINTFUL_API_KEY) return NextResponse.json({ source: "local" });
  const body = (await request.json().catch(() => null)) as { svg?: string; imageUrl?: string; finish?: string; size?: string } | null;
  const finish = isFrameFinish(body?.finish) ? body.finish : "black";
  const size = isFrameSize(body?.size) ? body.size : "11x14";
  const imageUrl = typeof body?.imageUrl === "string" && body.imageUrl.startsWith("https://") ? body.imageUrl : "";
  try {
    const publicUrl = imageUrl || (await publishSvg(body?.svg || ""));
    if (!publicUrl) {
      return NextResponse.json({ source: "local", error: "A public file store is required before Printful can photograph the frame." });
    }
    const result = await createFramedMockup(publicUrl, finish, size);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof HostingConfigError) return NextResponse.json({ source: "local", error: error.message });
    const message = error instanceof Error ? error.message : "The frame photograph could not be made.";
    return NextResponse.json({ source: "local", error: message });
  }
}

async function publishSvg(svg: string) {
  if (!svg.startsWith("<svg") || svg.length > 1_800_000) return "";
  const png = await sharp(Buffer.from(svg)).resize({ width: 1400, withoutEnlargement: true }).png().toBuffer();
  const key = `orders/ord_${randomBytes(9).toString("hex")}/portrait.png`;
  try {
    await putBytes(key, png, "image/png");
    return (await signedFileUrl(key, 60 * 60)) || "";
  } catch (error) {
    if (error instanceof HostingConfigError) return "";
    throw error;
  }
}
