import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { formatMoney, productById } from "@/lib/products";
import { HostingConfigError } from "@/lib/runtime";
import { DASHBOARD_COOKIE, getDesign, listDesigns, listLaunchSignups, listOrders, verifyDashboard, type LaunchSignup, type Order } from "@/lib/store";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const jar = await cookies();
  if (!verifyDashboard(jar.get(DASHBOARD_COOKIE)?.value)) redirect("/dashboard/login");
  let orders: Order[] = [];
  let signups: LaunchSignup[] = [];
  let proofsOnFile: Awaited<ReturnType<typeof listDesigns>> = [];
  try {
    [orders, signups, proofsOnFile] = await Promise.all([listOrders(), listLaunchSignups(), listDesigns()]);
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
  const proofs = new Map<string, { versions: number; approved?: number }>();
  await Promise.all(orders.map(async (order) => {
    const design = await getDesign(order.designId).catch(() => null);
    if (!design) return;
    proofs.set(order.id, { versions: design.versions?.length ?? 0, approved: order.approvedVersion ?? design.approvedVersion });
  }));
  return (
    <article className="page">
      <p className="kicker">Owner</p>
      <h1>Orders</h1>
      <form action="/api/dashboard/logout" method="post"><button className="btn-ghost" type="submit">Sign out</button></form>
      <h2>Proofs</h2>
      {proofsOnFile.length === 0 ? (
        <p className="note">No proofs yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>Portrait</th><th>Versions</th><th>Approval</th></tr>
            </thead>
            <tbody>
              {proofsOnFile.map((design) => (
                <tr key={design.id}>
                  <td>{new Date(design.createdAt).toLocaleString()}</td>
                  <td><Link href={`/proof/${design.id}`}>{design.style.headerName || "Untitled portrait"}</Link></td>
                  <td>{design.versions?.length ?? 0}</td>
                  <td>
                    {design.approvedVersion ? (
                      <>Approved: Version {design.approvedVersion} <a href={`/api/designs/${design.id}/asset/approved.png`}>Approved file</a></>
                    ) : (
                      "Not approved"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2>Launch list</h2>
      {signups.length === 0 ? (
        <p className="note">No one has joined the list yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>Email</th><th>Piece</th></tr>
            </thead>
            <tbody>
              {signups.map((signup) => (
                <tr key={signup.id}>
                  <td>{new Date(signup.createdAt).toLocaleString()}</td>
                  <td>{signup.email}</td>
                  <td>{productById(signup.productId).name} · {signup.sizeId}{signup.frameId ? ` · ${signup.frameId}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2>Paid orders</h2>
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
                <th>Proof</th>
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
                    <td>{order.printful ? `${order.printful.mode}, ${order.printful.status ?? ""} ${order.printful.id ?? ""}` : "None"}</td>
                    <td>{order.files ? <a href={`/api/orders/${order.id}/files/zip`}>Download</a> : "None"}</td>
                    <td>
                      {proofs.get(order.id)?.versions ? `${proofs.get(order.id)?.versions} versions` : "None"}
                      {proofs.get(order.id)?.approved ? (
                        <div className="note">Approved: Version {proofs.get(order.id)?.approved}. <a href={`/api/designs/${order.designId}/asset/approved.png`}>Approved file</a></div>
                      ) : null}
                    </td>
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
