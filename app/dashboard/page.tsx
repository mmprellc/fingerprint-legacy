import Link from "next/link";
import { money } from "@/lib/catalog";
import { dashboardPassword, isOwner } from "@/lib/server/auth";
import { listOrders } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const authed = await isOwner();
  if (!authed) {
    return (
      <main className="wrap order-card">
        <p className="eyebrow">Owner</p>
        <h1 style={{ fontSize: 56 }}>Orders</h1>
        <p className="help">
          {dashboardPassword()
            ? "The development password is legacy-demo until DASHBOARD_SECRET is set."
            : "Set DASHBOARD_SECRET before signing in."}
        </p>
        {params.error && <p className="error">That password was not accepted.</p>}
        <form action="/api/dashboard/login" method="post">
          <label className="field">
            <span>Password</span>
            <input type="password" name="password" required autoComplete="current-password" />
          </label>
          <button className="btn" type="submit" style={{ marginTop: 12 }}>
            Enter
          </button>
        </form>
      </main>
    );
  }

  const orders = await listOrders();
  return (
    <main className="wrap" style={{ padding: "32px 0 72px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "end" }}>
        <div>
          <p className="eyebrow">Owner</p>
          <h1 style={{ fontSize: 56 }}>Orders</h1>
        </div>
        <form action="/api/dashboard/logout" method="post">
          <button className="ghost" type="submit">
            Sign out
          </button>
        </form>
      </div>
      {orders.length === 0 ? (
        <p>No orders yet. A piece composed in the studio will show up here after checkout.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Customer</th>
                <th>Piece</th>
                <th>Status</th>
                <th>Fulfillment</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{new Date(order.createdAt).toLocaleString()}</td>
                  <td>
                    {order.customerName}
                    <div>{order.email}</div>
                  </td>
                  <td>
                    {order.summary}
                    <div>{money(order.amountCents)} · {order.mode}</div>
                  </td>
                  <td className="status">{order.status.replaceAll("_", " ")}</td>
                  <td>
                    {order.formatId === "digital" ? `File · ${order.emailDelivery.replaceAll("_", " ")}` : order.printful ? `${order.printful.mode} · ${order.printful.status}` : "—"}
                    {order.error && <div className="error">{order.error}</div>}
                  </td>
                  <td>
                    <Link href={`/order/${order.id}`}>View</Link>
                    {order.status !== "pending" && (
                      <>
                        <div>
                          <a href={`/api/orders/${order.id}/file?kind=png`}>PNG</a>
                        </div>
                      </>
                    )}
                    {order.status === "needs_attention" && (
                      <form action="/api/dashboard/retry" method="post">
                        <input type="hidden" name="orderId" value={order.id} />
                        <button className="ghost" type="submit">
                          Retry
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
