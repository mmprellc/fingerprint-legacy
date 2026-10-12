import fs from "node:fs";
import path from "node:path";
import type { FormatId, SizeId } from "../catalog";
import type { ShippingAddress } from "../design";

export type OrderStatus = "pending" | "paid" | "fulfilled" | "needs_attention";

export type Order = {
  id: string;
  createdAt: string;
  updatedAt: string;
  email: string;
  customerName: string;
  status: OrderStatus;
  formatId: FormatId;
  sizeId: SizeId;
  amountCents: number;
  mode: "stripe" | "mock";
  stripeSessionId?: string;
  shipping?: ShippingAddress;
  printful?: { id: string; status: string; mode: "live" | "mock"; error?: string };
  emailDelivery: "pending" | "queued_mock" | "sent" | "not_required";
  files: { svg: string; png: string; pdf: string };
  summary: string;
  error?: string;
};

const root = () => process.env.ORDERS_DIR || path.join(process.cwd(), "data");
const dbFile = () => path.join(root(), "orders.json");

let chain: Promise<unknown> = Promise.resolve();

function withLock<T>(work: () => T | Promise<T>): Promise<T> {
  const run = chain.then(work, work);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function readAll(): Order[] {
  const file = dbFile();
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Order[];
  return Array.isArray(parsed) ? parsed : [];
}

function writeAll(orders: Order[]) {
  const dir = root();
  fs.mkdirSync(dir, { recursive: true });
  const file = dbFile();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(orders, null, 2));
  fs.renameSync(tmp, file);
}

export function orderDir(id: string) {
  return path.join(root(), "files", id);
}

export async function createOrder(order: Order, files: { svg: string; png: Buffer; pdf: Buffer }) {
  return withLock(() => {
    const dir = orderDir(order.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "artwork.svg"), files.svg);
    fs.writeFileSync(path.join(dir, "artwork.png"), files.png);
    fs.writeFileSync(path.join(dir, "artwork.pdf"), files.pdf);
    const orders = readAll();
    orders.unshift(order);
    writeAll(orders);
    return order;
  });
}

export async function listOrders() {
  return withLock(() => readAll());
}

export async function getOrder(id: string) {
  return withLock(() => readAll().find((order) => order.id === id) ?? null);
}

export async function updateOrder(id: string, patch: Partial<Order>) {
  return withLock(() => {
    const orders = readAll();
    const index = orders.findIndex((order) => order.id === id);
    if (index < 0) return null;
    const next = { ...orders[index], ...patch, id, updatedAt: new Date().toISOString() };
    orders[index] = next;
    writeAll(orders);
    return next;
  });
}

export function readOrderFile(order: Order, kind: "svg" | "png" | "pdf") {
  const file = order.files[kind];
  const resolved = path.resolve(file);
  const allowed = path.resolve(orderDir(order.id));
  if (!resolved.startsWith(allowed + path.sep) && resolved !== allowed) {
    throw new Error("Unexpected file path.");
  }
  return fs.readFileSync(resolved);
}
