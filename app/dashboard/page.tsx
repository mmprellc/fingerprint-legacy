import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { formatMoney, productById } from "@/lib/products";
import { HostingConfigError } from "@/lib/runtime";
import { DASHBOARD_COOKIE, listOrders, verifyDashboard, type Order } from "@/lib/store";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const jar = await cookies();
  if (!verifyDashboard(jar.get(DASHBOARD_COOKIE)?.value)) redirect("/dashboard/login");
  let orders: Order[] = [];
  try {
    orders = await listOrders();
  } catch (error) {
    if (error instanceof HostingConfigError) {
      return (
        <article className="page">
          <p className="kicker">Owner</p>
          <h1>Orders</h1>
          <p className="alert" role="alert">{error.message}</p>
        </article>
      );
    }
    throw error;
  }
  return (
    <article className="page">
      <p className="kicker">Owner</p>
      <h1>Orders</h1>
      <form action="/api/dashboard/logout" method="post"><button className="btn-ghost" type="submit">Sign out</button></form>
      {orders.length === 0 ? (
        <div className="status-card">
          <p>No orders yet. When a piece is purchased it will appear here, with its status.</p>
          <Link className="btn-gold" href="/studio">Open the studio</Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Piece</th>
                <th>Email</th>
                <th>Status</th>
                <th>Print desk</th>
                <th>Files</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const product = productById(order.productId);
                return (
                  <tr key={order.id}>
                    <td>{new Date(order.createdAt).toLocaleString()}</td>
                    <td>
                      <Link href={`/orders/${order.id}`}>{product.name}</Link>
                      <div className="note">{formatMoney(order.amountCents)} · {order.checkout}</div>
                    </td>
                    <td>{order.email}</td>
                    <td><span className="pill">{order.status}</span>{order.error ? <div className="note">{order.error}</div> : null}</td>
                    <td>{order.printful ? `${order.printful.mode} · ${order.printful.status ?? ""} ${order.printful.id ?? ""}` : "—"}</td>
                    <td>{order.files ? <a href={`/api/orders/${order.id}/files/zip`}>Download</a> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
