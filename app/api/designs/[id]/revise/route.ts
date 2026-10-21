import { NextResponse } from "next/server";
import { readPrintStyle } from "@/lib/fingerprint/read-style";
import type { PrintStyle } from "@/lib/fingerprint/types";
import { describeStyleChange } from "@/lib/proof/diff";
import { proofCapacity, recordVersion } from "@/lib/proof/record";
import { getDesign } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const design = await getDesign(id);
  if (!design) return NextResponse.json({ error: "That proof could not be found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { style?: PrintStyle; sizeId?: string; productId?: string; note?: string } | null;
  const style = readPrintStyle(body?.style ?? design.style);
  const changes = describeStyleChange(design.style, style);
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 180) : changes[0];
  const saved = await recordVersion(design, {
    style,
    sizeId: body?.sizeId,
    productId: body?.productId,
    note,
    changes,
  });
  const version = saved.versions?.at(-1);
  return NextResponse.json({
    version,
    approvedVersion: saved.approvedVersion ?? null,
    capacity: version ? proofCapacity(saved, version.style) : "",
  });
}
