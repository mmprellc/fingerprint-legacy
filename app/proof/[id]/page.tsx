import type { Metadata } from "next";
import Link from "next/link";
import { randomBytes } from "node:crypto";
import { PROOF_LLM_ENV } from "@/lib/proof/interpret";
import { proofCapacity, recordVersion } from "@/lib/proof/record";
import { buyableProducts, productById } from "@/lib/products";
import { getDesign, saveDesign } from "@/lib/store";
import { ProofClient } from "./proof-client";

export const metadata: Metadata = { title: "Proof" };
export const dynamic = "force-dynamic";

export default async function ProofPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let design = await getDesign(id);
  if (!design) {
    return (
      <article className="page">
        <h1>This proof is not on file.</h1>
        <Link className="btn-gold" href="/studio">Open the studio</Link>
      </article>
    );
  }
  if (!design.shareToken) {
    design.shareToken = randomBytes(9).toString("hex");
    await saveDesign(design);
  }
  if (!design.versions?.length) {
    design = await recordVersion(design, { style: design.style, note: "Uploaded from the studio", changes: ["First proof."] });
  }
  const product = productById(design.productId);
  const latest = design.versions?.at(-1);
  return (
    <article className="page proof-page">
      <p className="kicker">Proof</p>
      <h1>{design.style.headerName || "Your portrait"}</h1>
      <p className="lede">Look at the print, the core, and a ridge. Change the words, then approve the version that should be printed.</p>
      <ProofClient
        model={{
          id: design.id,
          style: latest?.style ?? design.style,
          sizeId: latest?.sizeId ?? design.sizeId,
          productId: design.productId,
          frameId: design.frameId,
          versions: design.versions ?? [],
          approvedVersion: design.approvedVersion,
          comments: design.comments ?? [],
          sharePath: `/proof/${design.id}/family?token=${design.shareToken}`,
          capacity: proofCapacity(design, latest?.style ?? design.style),
          llmReady: Boolean((process.env[PROOF_LLM_ENV] || "").trim()),
          sizes: product.sizes.map((size) => ({ id: size.id, label: size.label })),
          products: buyableProducts.map((item) => ({
            id: item.id,
            name: item.name,
            sizes: item.sizes.map((size) => ({ id: size.id, label: size.label })),
          })),
        }}
      />
    </article>
  );
}
