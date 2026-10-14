import { NextResponse } from "next/server";
import { paymentsMode, printfulMode } from "@/lib/fulfill";
import { isPrelaunch, secretKeyMode } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    checkout: paymentsMode(),
    printful: isPrelaunch() ? "skipped" : printfulMode(),
    stripe: secretKeyMode(),
    prelaunch: isPrelaunch(),
  });
}
