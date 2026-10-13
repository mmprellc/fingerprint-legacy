import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { isProductionDeploy } from "./runtime";

let client: Stripe | null = null;
let clientKey = "";

export type KeyMode = "unset" | "test" | "live";

export function secretKeyMode(): KeyMode {
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key) return "unset";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  return "test";
}

export function publishableKeyMode(): KeyMode {
  const key = process.env.STRIPE_PUBLISHABLE_KEY || "";
  if (!key) return "unset";
  if (key.startsWith("pk_live_")) return "live";
  if (key.startsWith("pk_test_")) return "test";
  return "unset";
}

/**
 * Hosted Checkout does not embed the publishable key. It is still required in
 * live mode so the key pair is from the same mode before a charge is created.
 */
export function checkoutBlockedReason(): string | null {
  const secret = secretKeyMode();
  const publishable = publishableKeyMode();
  const webhook = Boolean((process.env.STRIPE_WEBHOOK_SECRET || "").trim());
  if (isProductionDeploy()) {
    if (secret !== "live") return "Set STRIPE_SECRET_KEY to a live restricted key (rk_live_…) before taking orders.";
    if (!webhook) return "Set STRIPE_WEBHOOK_SECRET from the live webhook endpoint.";
    if (publishable !== "live") return "Set STRIPE_PUBLISHABLE_KEY to the matching live publishable key (pk_live_…).";
    return null;
  }
  if (secret === "unset") return null;
  if (secret === "live" && !webhook) return "A live secret key needs STRIPE_WEBHOOK_SECRET so a paid order is fulfilled.";
  if (secret === "live" && publishable !== "live") return "STRIPE_PUBLISHABLE_KEY must be the matching pk_live_ key.";
  if (secret === "test" && publishable === "live") return "STRIPE_PUBLISHABLE_KEY is live but STRIPE_SECRET_KEY is a test key.";
  if (secret === "test" && process.env.STRIPE_PUBLISHABLE_KEY && publishable !== "test") {
    return "STRIPE_PUBLISHABLE_KEY must be a pk_test_ key when the secret key is a test key.";
  }
  return null;
}

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!client || clientKey !== key) {
    client = new Stripe(key, { apiVersion: "2026-09-30.endive" });
    clientKey = key;
  }
  return client;
}

export function integrationIdentifier() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(8);
  let suffix = "";
  for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
  return `fingerprint_legacy_${suffix}`;
}
