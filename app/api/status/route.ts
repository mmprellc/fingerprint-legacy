import { NextResponse } from "next/server";
import { paymentsMode } from "@/lib/server/stripe";

export function GET() {
  return NextResponse.json({
    payments: paymentsMode(),
    printful: process.env.PRINTFUL_API_KEY?.trim() ? "live" : "mock",
  });
}
