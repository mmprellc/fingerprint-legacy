"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FORMATS, SIZES, money } from "@/lib/catalog";
import type { CheckoutInput } from "@/lib/design";

const countries = ["US", "CA", "GB", "AU", "NZ", "IE", "DE", "FR", "NL", "SE", "NO", "DK"];

export default function CheckoutPage() {
  const [design, setDesign] = useState<Omit<CheckoutInput, "email" | "customerName" | "shipping"> | null>(null);
  const [mode, setMode] = useState<"stripe" | "mock" | "">("");
  const [email, setEmail] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [shipping, setShipping] = useState({
    name: "",
    address1: "",
    address2: "",
    city: "",
    state: "",
    postal: "",
    country: "US",
    phone: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canceled = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("canceled");

  useEffect(() => {
    const raw = sessionStorage.getItem("fl-design");
    if (!raw) return;
    try {
      setDesign(JSON.parse(raw));
    } catch {
      setDesign(null);
    }
    fetch("/api/status")
      .then((response) => response.json())
      .then((body) => setMode(body.payments))
      .catch(() => setMode("mock"));
  }, []);

  if (!design) {
    return (
      <main className="wrap order-card">
        <h1>Nothing is waiting to print.</h1>
        <p>Compose a piece in the studio first.</p>
        <Link className="btn" href="/studio">
          Back to the studio
        </Link>
      </main>
    );
  }

  const format = FORMATS[design.formatId];
  const needsAddress = format.ships && mode === "mock";

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const payload: CheckoutInput = {
      ...design!,
      email,
      customerName,
      shipping: needsAddress ? { ...shipping, name: shipping.name || customerName } : undefined,
    };
    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "The order could not be started.");
      setBusy(false);
      return;
    }
    window.location.href = body.url;
  }

  return (
    <main className="wrap order-card">
      <p className="eyebrow">Checkout</p>
      <h1 style={{ fontSize: 56 }}>Review the order.</h1>
      {canceled && <p className="error">Payment was canceled. Your design is still here.</p>}
      <p>
        <strong>{format.name}</strong> · {SIZES[design.sizeId].label}
      </p>
      <p className="lede">{format.summary}</p>
      <p>
        <strong style={{ fontFamily: "var(--font-display)", fontSize: 42 }}>{money(format.prices[design.sizeId])}</strong>
      </p>
      {mode === "mock" && <p className="help">Stripe is not configured, so this checkout stays in test mode and completes without a card.</p>}
      {mode === "stripe" && format.ships && <p className="help">The shipping address is collected on the secure payment page.</p>}
      <form onSubmit={pay}>
        <label className="field">
          <span>Your name</span>
          <input required value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
        </label>
        <label className="field">
          <span>Email</span>
          <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        {needsAddress && (
          <>
            <label className="field">
              <span>Ship to</span>
              <input required value={shipping.name} onChange={(event) => setShipping({ ...shipping, name: event.target.value })} />
            </label>
            <label className="field">
              <span>Address</span>
              <input required value={shipping.address1} onChange={(event) => setShipping({ ...shipping, address1: event.target.value })} />
            </label>
            <label className="field">
              <span>Apartment, suite</span>
              <input value={shipping.address2} onChange={(event) => setShipping({ ...shipping, address2: event.target.value })} />
            </label>
            <div className="colors">
              <label className="field">
                <span>City</span>
                <input required value={shipping.city} onChange={(event) => setShipping({ ...shipping, city: event.target.value })} />
              </label>
              <label className="field">
                <span>State</span>
                <input required value={shipping.state} onChange={(event) => setShipping({ ...shipping, state: event.target.value })} />
              </label>
            </div>
            <div className="colors">
              <label className="field">
                <span>Postal code</span>
                <input required value={shipping.postal} onChange={(event) => setShipping({ ...shipping, postal: event.target.value })} />
              </label>
              <label className="field">
                <span>Country</span>
                <select value={shipping.country} onChange={(event) => setShipping({ ...shipping, country: event.target.value })}>
                  {countries.map((country) => (
                    <option key={country}>{country}</option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn full" type="submit" disabled={busy || !mode} style={{ marginTop: 16 }}>
          {busy ? "Preparing the files…" : mode === "mock" ? "Continue to test payment" : "Pay securely"}
        </button>
      </form>
    </main>
  );
}
