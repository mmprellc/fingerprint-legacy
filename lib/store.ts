import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PreviewPrint } from "./fingerprint/preview";
import type { PrintStyle } from "./fingerprint/types";

const root = path.join(process.cwd(), "data");

export type Shipping = {
  name: string;
  phone: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postal: string;
  country: string;
};

export type OrderStatus = "pending" | "paid" | "fulfilled" | "failed";

export type Order = {
  id: string;
  createdAt: string;
  email: string;
  productId: string;
  sizeId: string;
  amountCents: number;
  status: OrderStatus;
  checkout: "mock" | "stripe";
  stripeSessionId?: string;
  designId: string;
  shipping?: Shipping;
  printful?: { mode: "mock" | "live"; id?: string; status?: string; error?: string };
  emailDelivery?: { mode: "mock" | "resend"; to: string; subject: string; body: string; at: string };
  files?: { svg: boolean; png: boolean; pdf: boolean };
  error?: string;
};

export type Design = {
  id: string;
  createdAt: string;
  prints: PreviewPrint[];
  style: PrintStyle;
  period: number;
  productId: string;
  sizeId: string;
};

let chain: Promise<unknown> = Promise.resolve();

function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.then(work, work);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readOrders(): Promise<Order[]> {
  try {
    const raw = await fs.readFile(path.join(root, "orders.json"), "utf8");
    const parsed = JSON.parse(raw) as Order[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeOrders(orders: Order[]) {
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, "orders.json");
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(orders, null, 2));
  await fs.rename(tmp, file);
}

export function newId(prefix: string) {
  return `${prefix}_${randomBytes(9).toString("hex")}`;
}

export async function saveDesign(design: Design) {
  const dir = path.join(root, "designs", design.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "design.json"), JSON.stringify(design));
  return design;
}

export async function getDesign(id: string) {
  if (!/^dsn_[a-f0-9]+$/.test(id)) return null;
  try {
    const raw = await fs.readFile(path.join(root, "designs", id, "design.json"), "utf8");
    return JSON.parse(raw) as Design;
  } catch {
    return null;
  }
}

export async function savePreview(id: string, png: Buffer) {
  const dir = path.join(root, "designs", id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "preview.png"), png);
}

export function previewPath(id: string) {
  return path.join(root, "designs", id, "preview.png");
}

export function orderFileDir(id: string) {
  return path.join(root, "files", id);
}

export async function createOrder(input: Omit<Order, "id" | "createdAt" | "status">) {
  return exclusive(async () => {
    const orders = await readOrders();
    const order: Order = { ...input, id: newId("ord"), createdAt: new Date().toISOString(), status: "pending" };
    orders.unshift(order);
    await writeOrders(orders);
    return order;
  });
}

export async function updateOrder(id: string, patch: (order: Order) => void) {
  return exclusive(async () => {
    const orders = await readOrders();
    const order = orders.find((item) => item.id === id);
    if (!order) return null;
    patch(order);
    await writeOrders(orders);
    return order;
  });
}

export async function getOrder(id: string) {
  if (!/^ord_[a-f0-9]+$/.test(id)) return null;
  const orders = await readOrders();
  return orders.find((order) => order.id === id) ?? null;
}

export async function listOrders() {
  return readOrders();
}

export async function findOrderBySession(sessionId: string) {
  const orders = await readOrders();
  return orders.find((order) => order.stripeSessionId === sessionId) ?? null;
}

function appSecret() {
  return process.env.APP_SECRET || "fingerprint-legacy-dev-secret";
}

export function signDownload(orderId: string) {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 30;
  const payload = `${orderId}.${exp}`;
  const sig = createHmac("sha256", appSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyDownload(token: string, orderId: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [id, exp, sig] = parts;
  if (id !== orderId || Number(exp) < Date.now()) return false;
  const payload = `${id}.${exp}`;
  const expected = createHmac("sha256", appSecret()).update(payload).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function dashboardPassword() {
  return process.env.DASHBOARD_PASSWORD || "dev-legacy";
}

export function dashboardUsesDefaultPassword() {
  return !process.env.DASHBOARD_PASSWORD;
}

export function signDashboard() {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 14;
  const payload = `dash.${exp}`;
  const sig = createHmac("sha256", appSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyDashboard(token: string | undefined) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [kind, exp, sig] = parts;
  if (kind !== "dash" || Number(exp) < Date.now()) return false;
  const expected = createHmac("sha256", appSecret()).update(`${kind}.${exp}`).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const DASHBOARD_COOKIE = "fl_dash";
