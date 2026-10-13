import { NextResponse } from "next/server";
import { DASHBOARD_COOKIE, dashboardConfigError, dashboardPassword, signDashboard } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const form = await request.formData();
  if (dashboardConfigError()) {
    return NextResponse.redirect(new URL("/dashboard/login?error=config", origin), 303);
  }
  const password = String(form.get("password") || "");
  if (!password || password !== dashboardPassword()) {
    return NextResponse.redirect(new URL("/dashboard/login?error=1", origin), 303);
  }
  const response = NextResponse.redirect(new URL("/dashboard", origin), 303);
  response.cookies.set(DASHBOARD_COOKIE, signDashboard(), {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https"),
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  return response;
}
