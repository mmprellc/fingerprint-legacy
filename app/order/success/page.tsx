"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { OrderStatus } from "@/components/order-status";

function Success() {
  const params = useSearchParams();
  const id = params.get("order") || "";
  const sessionId = params.get("session_id") || undefined;
  if (!id) return <p>Missing order.</p>;
  return <OrderStatus id={id} sessionId={sessionId} />;
}

export default function SuccessPage() {
  return (
    <main className="wrap order-card">
      <Suspense>
        <Success />
      </Suspense>
    </main>
  );
}
