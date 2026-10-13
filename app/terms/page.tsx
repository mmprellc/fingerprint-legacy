import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <article className="page">
      <p className="kicker">Terms</p>
      <h1>A plain account of the purchase.</h1>
      <div className="stack">
        <p>You confirm you have the right to use the fingerprint and the words. The portrait is generated automatically from what you submit.</p>
        <p>Digital files are delivered on the confirmation page. Printed pieces are produced by Printful and shipped to the address on the order. This prototype completes payment in test mode when Stripe keys are not set, and it records a mock print order in that case.</p>
        <p>Jewelry and keepsake pages describe future objects. Only the formats marked for sale on the pricing page can be purchased.</p>
        <p><Link href="/pricing">See pricing</Link></p>
      </div>
    </article>
  );
}
