import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/runtime";
import { DASHBOARD_COOKIE } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = publicOrigin(request);
  const response = NextResponse.redirect(new URL("/dashboard/login", origin), 303);
  response.cookies.set(DASHBOARD_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
