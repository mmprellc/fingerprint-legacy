import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney, productById } from "@/lib/products";
import { getOrder } from "@/lib/store";

export const metadata: Metadata = { title: "Your order" };
export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();
  const product = productById(order.productId);
  return (
    <article className="page">
      <p className="kicker">Receipt</p>
      <h1>{product.name}</h1>
      <div className="status-card">
        <img src={`/api/designs/${order.designId}/preview`} alt="The ordered portrait" />
        <p>Order {order.id}</p>
        <p>{formatMoney(order.amountCents)} · <span className="pill">{order.status}</span></p>
        <p>For {order.email}</p>
        {order.shipping?.address1 ? (
          <p>{order.shipping.name}, {order.shipping.address1}, {order.shipping.city} {order.shipping.state} {order.shipping.postal}, {order.shipping.country}</p>
        ) : null}
        {order.files ? (
          <div className="downloads">
            <a className="btn-dark" href={`/api/orders/${order.id}/files/png`}>PNG</a>
            <a className="btn-ghost" href={`/api/orders/${order.id}/files/svg`}>SVG</a>
            <a className="btn-ghost" href={`/api/orders/${order.id}/files/pdf`}>PDF</a>
            <a className="btn-ghost" href={`/api/orders/${order.id}/files/zip`}>Zip</a>
          </div>
        ) : <p>Files are not ready yet. <Link href={`/orders/success?order=${order.id}`}>Check confirmation</Link></p>}
        {order.printful ? <p>Print desk · {order.printful.mode} · {order.printful.status} {order.printful.id ?? ""}</p> : null}
        <p><Link href="/">Home</Link> · <Link href="/studio">Studio</Link></p>
      </div>
    </article>
  );
}
