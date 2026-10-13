import type { Metadata } from "next";
import Link from "next/link";
import { formatMoney, productById } from "@/lib/products";
import { getOrder } from "@/lib/store";

export const metadata: Metadata = { title: "Test payment" };
export const dynamic = "force-dynamic";

export default async function MockCheckoutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const orderId = typeof params.order === "string" ? params.order : "";
  const order = orderId ? await getOrder(orderId) : null;
  if (!order) {
    return (
      <article className="page">
        <h1>There is no test order to pay.</h1>
        <Link className="btn-gold" href="/studio">Open the studio</Link>
      </article>
    );
  }
  const product = productById(order.productId);
  return (
    <article className="page">
      <p className="kicker">Test mode</p>
      <h1>Place the order without a charge.</h1>
      <form className="form-card" action="/api/checkout/mock-complete" method="post">
        <input type="hidden" name="orderId" value={order.id} />
        <p>{product.name} · {formatMoney(order.amountCents)}</p>
        <p className="note">Use the sample card if you like. It is not sent anywhere. This records the order, prepares the files, and, for a print, files a mock Printful job.</p>
        <label className="field"><span>Card number</span><input name="card" defaultValue="4242 4242 4242 4242" autoComplete="off" /></label>
        <label className="field"><span>Expiry</span><input name="exp" defaultValue="12 / 34" autoComplete="off" /></label>
        <label className="field"><span>CVC</span><input name="cvc" defaultValue="123" autoComplete="off" /></label>
        <button className="btn-gold" type="submit">Place test order</button>
        <p><Link href={`/checkout?design=${order.designId}`}>Back to the order</Link></p>
      </form>
    </article>
  );
}
