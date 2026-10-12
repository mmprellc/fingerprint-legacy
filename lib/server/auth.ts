import crypto from "node:crypto";
import { cookies } from "next/headers";

function secret() {
  return process.env.DASHBOARD_SECRET || process.env.ORDERS_DIR || "fingerprint-legacy-dev-secret";
}

export function dashboardPassword() {
  if (process.env.DASHBOARD_SECRET) return process.env.DASHBOARD_SECRET;
  if (process.env.NODE_ENV === "production") return null;
  return "legacy-demo";
}

export function signOwnerCookie() {
  const mac = crypto.createHmac("sha256", secret()).update("owner").digest("hex");
  return `owner.${mac}`;
}

export function cookieMatches(value: string | undefined) {
  if (!value) return false;
  const expected = signOwnerCookie();
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function isOwner() {
  const jar = await cookies();
  return cookieMatches(jar.get("fl_owner")?.value);
}

export function passwordsMatch(given: string) {
  const expected = dashboardPassword();
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
