import { NextResponse } from "next/server";
import { passwordsMatch, signOwnerCookie } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get("password") || "");
  const url = new URL("/dashboard", request.url);
  if (!passwordsMatch(password)) {
    url.searchParams.set("error", "1");
    return NextResponse.redirect(url, 303);
  }
  const response = NextResponse.redirect(url, 303);
  response.cookies.set("fl_owner", signOwnerCookie(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  return response;
}
