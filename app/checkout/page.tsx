import type { Metadata } from "next";
import Link from "next/link";
import { paymentsMode } from "@/lib/fulfill";
import { buyableProducts, formatMoney, productById } from "@/lib/products";
import { HostingConfigError } from "@/lib/runtime";
import { getDesign } from "@/lib/store";
import { CheckoutForm } from "./checkout-form";

export const metadata: Metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const designId = typeof params.design === "string" ? params.design : "";
  let design = null;
  try {
    design = designId ? await getDesign(designId) : null;
  } catch (error) {
    if (error instanceof HostingConfigError) {
      return (
        <article className="page">
          <h1>Orders are not open yet.</h1>
          <p className="lede">The host is missing its database. Run the production check, then try again.</p>
        </article>
      );
    }
    throw error;
  }
  const error = typeof params.error === "string" ? params.error : "";
  if (!design) {
    return (
      <article className="page">
        <h1>Nothing is waiting to be ordered.</h1>
        <p className="lede">Make a portrait in the studio, then come back to this step.</p>
        <Link className="btn-gold" href="/studio">Open the studio</Link>
      </article>
    );
  }
  if (design.versions?.length && !design.approvedVersion) {
    return (
      <article className="page">
        <p className="kicker">Checkout</p>
        <h1>Approve the proof first.</h1>
        <p className="lede">Checkout uses the version you approve. Nothing is sent to print before that.</p>
        <Link className="btn-gold" href={`/proof/${design.id}`}>Return to the proof</Link>
      </article>
    );
  }
  const approved = design.versions?.find((version) => version.number === design.approvedVersion);
  const product = productById(approved?.productId || design.productId);
  const mode = paymentsMode();
  const joined = params.joined === "1" && mode === "waitlist";
  if (joined) {
    return (
      <article className="page">
        <p className="kicker">Checkout</p>
        <h1>You're on the list.</h1>
        <p className="lede">We'll write when orders open. Nothing was charged, and nothing was sent to print.</p>
        <Link className="btn-gold" href="/studio">Return to the studio</Link>
      </article>
    );
  }
  return (
    <article className="page">
      <p className="kicker">Checkout</p>
      <h1>{mode === "waitlist" ? "Orders open soon." : "Review the piece."}</h1>
      {mode === "waitlist" ? <p className="lede">Join the list. No payment is taken, and nothing is sent to print.</p> : null}
      {error ? <p className="alert">{messageFor(error)}</p> : null}
      <CheckoutForm
          designId={design.id}
          productId={product.available ? product.id : "digital"}
          sizeId={approved?.sizeId || design.sizeId}
          frameId={design.frameId || "black"}
          imageUrl={`/api/designs/${design.id}/preview`}
          products={buyableProducts.map((item) => ({
            id: item.id,
            name: item.name,
            price: formatMoney(item.priceCents),
            fulfillment: item.fulfillment,
            sizes: item.sizes.map((size) => ({ id: size.id, label: size.label })),
          }))}
          mode={mode}
        />
    </article>
  );
}

function messageFor(error: string) {
  if (error === "email") return "Enter an email address so the portrait has a place to go.";
  if (error === "address") return "A printed piece needs a shipping address.";
  if (error === "stripe") return "Stripe did not return a payment page. Try again.";
  if (error === "approve") return "Approve the proof before checkout.";
  if (error === "payments") return "Payments are not ready on this site yet.";
  if (error === "storage") return "The list could not be saved. The host is missing its database.";
  return "Something about the order needs another look.";
}
