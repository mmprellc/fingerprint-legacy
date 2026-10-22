import { NextResponse } from "next/server";
import { renderApproved } from "@/lib/proof/record";
import { getDesign, saveDesign } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const design = await getDesign(id);
  if (!design) return NextResponse.json({ error: "That proof could not be found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { number?: number } | null;
  const number = Number(body?.number) || design.versions?.at(-1)?.number;
  const version = design.versions?.find((item) => item.number === number);
  if (!version) return NextResponse.json({ error: "Choose a version to approve." }, { status: 400 });
  const before = design.versions?.length ?? 0;
  design.approvedVersion = version.number;
  design.style = version.style;
  design.sizeId = version.sizeId;
  design.productId = version.productId;
  await renderApproved(design, version);
  await saveDesign(design);
  if ((design.versions?.length ?? 0) !== before) {
    return NextResponse.json({ error: "Approval must not create a version." }, { status: 500 });
  }
  return NextResponse.json({ approvedVersion: version.number });
}
