import { NextResponse } from "next/server";
import { paymentsMode, printfulMode } from "@/lib/fulfill";
import { secretKeyMode } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    checkout: paymentsMode(),
    printful: printfulMode(),
    stripe: secretKeyMode(),
  });
}
