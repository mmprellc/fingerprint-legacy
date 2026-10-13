import { randomBytes } from "node:crypto";
import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!client) {
    client = new Stripe(key, { apiVersion: "2026-09-30.endive" });
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
