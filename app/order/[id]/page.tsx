import { OrderStatus } from "@/components/order-status";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="wrap order-card">
      <OrderStatus id={id} />
    </main>
  );
}
