import type { Metadata } from "next";
import { dashboardUsesDefaultPassword } from "@/lib/store";

export const metadata: Metadata = { title: "Owner sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const failed = params.error === "1";
  const unconfigured = params.error === "config";
  return (
    <article className="page">
      <p className="kicker">Owner</p>
      <h1>The order book.</h1>
      <form className="form-card" action="/api/dashboard/login" method="post">
        {unconfigured ? <p className="alert" role="alert">Set DASHBOARD_PASSWORD before the order book can open.</p> : null}
        {failed ? <p className="alert" role="alert">That password did not open the book.</p> : null}
        {dashboardUsesDefaultPassword() ? <p className="note">Prototype password: dev-legacy</p> : null}
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        <button className="btn-gold" type="submit">Enter</button>
      </form>
    </article>
  );
}
