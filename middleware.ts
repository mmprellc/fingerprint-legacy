import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "@/lib/csp";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const url = request.nextUrl;
  const host = request.headers.get("host") || url.host;
  response.headers.set(
    "Content-Security-Policy",
    contentSecurityPolicy({ host }),
  );
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
