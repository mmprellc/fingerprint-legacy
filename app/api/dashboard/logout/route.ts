import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/dashboard", request.url), 303);
  response.cookies.set("fl_owner", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
