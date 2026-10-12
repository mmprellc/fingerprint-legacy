import type { Metadata } from "next";
import Link from "next/link";
import { formatMoney, productById } from "@/lib/products";
import { getOrder } from "@/lib/store";

export const metadata: Metadata = { title: "Order confirmed" };
export const dynamic = "force-dynamic";

export default async function SuccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const orderId = typeof params.order === "string" ? params.order : "";
  const order = orderId ? await getOrder(orderId) : null;
  if (!order) {
    return (
      <article className="page">
        <h1>We cannot find that order.</h1>
        <Link className="btn-gold" href="/studio">Open the studio</Link>
      </article>
    );
  }
  const product = productById(order.productId);
  return (
    <article className="page">
      <p className="kicker">Confirmed</p>
      <h1>The portrait is on its way to you.</h1>
      <div className="status-card">
        <p>Order {order.id}</p>
        <p>{product.name} · {formatMoney(order.amountCents)}</p>
        <p>Status <span className="pill">{order.status}</span></p>
        {order.files ? (
          <div className="downloads">
            <a className="btn-dark" href={`/api/orders/${order.id}/files/png`}>Download PNG</a>
            <a className="btn-ghost" href={`/api/orders/${order.id}/files/svg`}>SVG</a>
            <a className="btn-ghost" href={`/api/orders/${order.id}/files/pdf`}>PDF</a>
            <a className="btn-ghost" href={`/api/orders/${order.id}/files/zip`}>All three</a>
          </div>
        ) : (
          <p>The files are still being prepared. Refresh this page in a moment.</p>
        )}
        {order.printful ? (
          <p>Print desk: {order.printful.mode === "mock" ? "mock order" : "Printful"} {order.printful.id ? `· ${order.printful.id}` : ""} · {order.printful.status}{order.printful.error ? ` · ${order.printful.error}` : ""}</p>
        ) : null}
        {order.emailDelivery ? (
          <p className="note">
            {order.emailDelivery.mode === "mock"
              ? `Email is not connected, so nothing was sent. The note we would have mailed to ${order.email} is kept on the order.`
              : `A note was sent to ${order.email}.`}
          </p>
        ) : null}
        {order.error ? <p className="alert">{order.error}</p> : null}
        <p><Link href={`/orders/${order.id}`}>Open the full receipt</Link></p>
        <p><Link href="/studio">Make another</Link></p>
      </div>
    </article>
  );
}
