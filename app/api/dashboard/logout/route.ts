import { NextResponse } from "next/server";
import { DASHBOARD_COOKIE } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const response = NextResponse.redirect(new URL("/dashboard/login", origin), 303);
  response.cookies.set(DASHBOARD_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
