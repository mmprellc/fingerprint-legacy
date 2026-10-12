"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function MockPay() {
  const params = useSearchParams();
  const orderId = params.get("order") || "";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function pay() {
    setBusy(true);
    setError("");
    const response = await fetch("/api/checkout/mock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "The test payment failed.");
      setBusy(false);
      return;
    }
    window.location.href = `/order/${orderId}`;
  }

  return (
    <main className="wrap order-card">
      <p className="eyebrow">Test payment</p>
      <h1 style={{ fontSize: 52 }}>No card required.</h1>
      <p className="lede">
        Stripe keys are not set, so this stands in for Checkout. Completing it marks the order paid and, for a physical
        piece, creates a mock Printful order.
      </p>
      {error && <p className="error">{error}</p>}
      <button className="btn" type="button" disabled={!orderId || busy} onClick={() => void pay()}>
        {busy ? "Finishing…" : "Complete test payment"}
      </button>
    </main>
  );
}

export default function MockCheckoutPage() {
  return (
    <Suspense>
      <MockPay />
    </Suspense>
  );
}
