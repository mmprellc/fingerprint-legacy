import Stripe from "stripe";

export const INTEGRATION_IDENTIFIER = "fingerprint_legacy_checkout_wqnrltbz";

export function paymentsMode(): "stripe" | "mock" {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key || key.includes("replace") || key.endsWith("...")) return "mock";
  return "stripe";
}

let stripe: Stripe | null = null;

/** Node's client class is `Stripe`. Methods are called on this instance, never via a global key. */
export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  if (!stripe) {
    stripe = new Stripe(key, { apiVersion: "2026-09-30.endive" });
  }
  return stripe;
}
