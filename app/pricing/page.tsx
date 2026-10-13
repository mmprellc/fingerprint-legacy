import type { Metadata } from "next";
import Link from "next/link";
import { FramedExamples } from "@/components/FramedExamples";
import { formatMoney, buyableProducts } from "@/lib/products";

export const metadata: Metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <article className="page">
      <p className="kicker">Formats & pricing</p>
      <h1>Choose how you will hold it.</h1>
      <p className="lede">The portrait is the same. The object changes. Shipping for printed pieces is included, and the press is ordered automatically after payment.</p>
      <div className="price-grid">
        {buyableProducts.map((product) => (
          <section key={product.id} className="price" id={product.id}>
            <h2>{product.name}</h2>
            <p className="amount">{formatMoney(product.priceCents)}</p>
            <p>{product.summary}</p>
            <ul>
              {product.details.map((detail) => <li key={detail}>{detail}</li>)}
            </ul>
            <p className="note">{product.sizes.map((size) => size.label).join(" · ")}</p>
            <Link className="btn-gold" href={`/studio?product=${product.id}`}>Create this</Link>
          </section>
        ))}
      </div>
      <section className="band">
        <p className="kicker">Framed print</p>
        <h2>Three mouldings, one portrait.</h2>
        <p>Randy Czyz’s piece, shown in the frames a customer can choose. The studio wraps their own artwork the same way.</p>
        <FramedExamples src="/pieces/randy-czyz.png" title="Randy Czyz" />
        <p><Link className="btn-gold" href="/studio?piece=randy-czyz&product=framed">Frame this portrait</Link></p>
      </section>
      <section className="band">
        <h2>Jewelry, urns, and other keepsakes</h2>
        <p>They are in the catalog so a production partner can be attached later. They are not charged today. The artwork they would carry is the file you can buy now.</p>
        <p>
          <Link href="/keepsakes/jewelry">Jewelry</Link> · <Link href="/keepsakes/urns">Urns</Link> · <Link href="/keepsakes/custom">Custom keepsakes</Link>
        </p>
      </section>
    </article>
  );
}
