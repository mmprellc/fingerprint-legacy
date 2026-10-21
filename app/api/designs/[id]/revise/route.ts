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
  const body = (await request.json().catch(() => null)) as {
    style?: PrintStyle;
    sizeId?: string;
    productId?: string;
    note?: string;
    revertTo?: number;
  } | null;
  const revertTo = Number(body?.revertTo);
  if (Number.isFinite(revertTo) && revertTo > 0) {
    const source = design.versions?.find((item) => item.number === revertTo);
    if (!source) return NextResponse.json({ error: "That version is not on this proof." }, { status: 400 });
    const next = (design.versions?.at(-1)?.number ?? 0) + 1;
    const note = `Reverted to Version ${source.number} (saved as Version ${next})`;
    const saved = await recordVersion(design, {
      style: source.style,
      sizeId: source.sizeId,
      productId: source.productId,
      note,
      changes: [note],
    });
    const version = saved.versions?.at(-1);
    return NextResponse.json({
      version,
      approvedVersion: saved.approvedVersion ?? null,
      capacity: version ? proofCapacity(saved, version.style, version.sizeId, version.productId) : "",
    });
  }
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
    capacity: version ? proofCapacity(saved, version.style, version.sizeId, version.productId) : "",
  });
}
