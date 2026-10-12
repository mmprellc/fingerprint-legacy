"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/catalog";

type PublicOrder = {
  id: string;
  status: string;
  summary: string;
  amountCents: number;
  emailDelivery: string;
  formatId: string;
  error?: string;
  printful?: { status: string; mode: string };
  ready: boolean;
};

export function OrderStatus({ id, sessionId }: { id: string; sessionId?: string }) {
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    async function tick() {
      if (sessionId) {
        await fetch("/api/orders/reconcile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: id, sessionId }),
        });
      }
      const response = await fetch(`/api/orders/${id}`);
      const body = await response.json();
      if (stop) return;
      if (!response.ok) {
        setError(body.error || "Order not found.");
        return;
      }
      setOrder(body.order);
      if (body.order.status === "pending") window.setTimeout(tick, 2000);
    }
    void tick();
    return () => {
      stop = true;
    };
  }, [id, sessionId]);

  if (error) return <p className="error">{error}</p>;
  if (!order) return <p>Looking up the order…</p>;

  return (
    <div>
      <p className="eyebrow">{order.status.replaceAll("_", " ")}</p>
      <h1 style={{ fontSize: 56 }}>{order.summary}</h1>
      <p>{money(order.amountCents)}</p>
      {order.status === "pending" && <p>Waiting for payment to clear. This page updates on its own.</p>}
      {order.error && <p className="error">{order.error}</p>}
      {order.printful && (
        <p>
          Printful: {order.printful.status} ({order.printful.mode === "mock" ? "mock — no key configured" : "submitted"})
        </p>
      )}
      {order.formatId === "digital" && order.status === "fulfilled" && (
        <p>The files are ready here. A copy of the note is saved with the order{order.emailDelivery === "sent" ? " and was emailed" : ""}.</p>
      )}
      {order.ready && order.status !== "pending" && (
        <div className="row" style={{ marginTop: 12 }}>
          <a className="btn" href={`/api/orders/${order.id}/file?kind=png`}>
            PNG
          </a>
          <a className="btn secondary" href={`/api/orders/${order.id}/file?kind=pdf`}>
            PDF
          </a>
          <a className="btn secondary" href={`/api/orders/${order.id}/file?kind=svg`}>
            SVG
          </a>
        </div>
      )}
      <p style={{ marginTop: 18 }}>
        <Link href="/studio">Make another</Link>
      </p>
    </div>
  );
}
