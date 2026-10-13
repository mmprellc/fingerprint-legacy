import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PreviewPrint } from "./fingerprint/preview";
import type { PrintStyle } from "./fingerprint/types";
import { previewObjectKey, putBytes } from "./files";
import type postgres from "postgres";
import { HostingConfigError, databaseUrl, isProductionDeploy, requiresDurableStorage } from "./runtime";

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
  frameId?: string;
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
  frameId?: string;
};

function usingPostgres() {
  if (databaseUrl()) return true;
  if (requiresDurableStorage()) {
    throw new HostingConfigError("Set DATABASE_URL to a Neon or Vercel Postgres connection string. Local disk is only for development.");
  }
  return false;
}

export function newId(prefix: string) {
  return `${prefix}_${randomBytes(9).toString("hex")}`;
}

export async function saveDesign(design: Design) {
  if (usingPostgres()) return saveDesignPg(design);
  const dir = path.join(root, "designs", design.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "design.json"), JSON.stringify(design));
  return design;
}

export async function getDesign(id: string) {
  if (!/^dsn_[a-f0-9]+$/.test(id)) return null;
  if (usingPostgres()) return getDesignPg(id);
  try {
    const raw = await fs.readFile(path.join(root, "designs", id, "design.json"), "utf8");
    return JSON.parse(raw) as Design;
  } catch {
    return null;
  }
}

export async function savePreview(id: string, png: Buffer) {
  const key = previewObjectKey(id);
  if (!key) return;
  await putBytes(key, png, "image/png");
}

export async function createOrder(input: Omit<Order, "id" | "createdAt" | "status">) {
  const order: Order = { ...input, id: newId("ord"), createdAt: new Date().toISOString(), status: "pending" };
  if (usingPostgres()) return createOrderPg(order);
  return exclusive(async () => {
    const orders = await readOrders();
    orders.unshift(order);
    await writeOrders(orders);
    return order;
  });
}

export async function updateOrder(id: string, patch: (order: Order) => void) {
  if (usingPostgres()) return updateOrderPg(id, patch);
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
  if (usingPostgres()) return getOrderPg(id);
  const orders = await readOrders();
  return orders.find((order) => order.id === id) ?? null;
}

export async function listOrders() {
  if (usingPostgres()) return listOrdersPg();
  return readOrders();
}

export async function findOrderBySession(sessionId: string) {
  if (!sessionId) return null;
  if (usingPostgres()) return findOrderBySessionPg(sessionId);
  const orders = await readOrders();
  return orders.find((order) => order.stripeSessionId === sessionId) ?? null;
}

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

function appSecret() {
  const secret = (process.env.APP_SECRET || "").trim();
  if (secret.length >= 24) return secret;
  if (isProductionDeploy()) {
    throw new HostingConfigError("Set APP_SECRET to a random string of at least 24 characters.");
  }
  return secret || "fingerprint-legacy-dev-secret";
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
  const set = process.env.DASHBOARD_PASSWORD;
  if (set) return set;
  if (requiresDurableStorage()) return "";
  return "dev-legacy";
}

export function dashboardUsesDefaultPassword() {
  return !process.env.DASHBOARD_PASSWORD && !requiresDurableStorage();
}

export function dashboardConfigError() {
  if (requiresDurableStorage() && !process.env.DASHBOARD_PASSWORD) {
    return "Set DASHBOARD_PASSWORD before the order book can open.";
  }
  if (isProductionDeploy() && (process.env.APP_SECRET || "").trim().length < 24) {
    return "Set APP_SECRET to a random string of at least 24 characters.";
  }
  return null;
}

export function signDashboard() {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 14;
  const payload = `dash.${exp}`;
  const sig = createHmac("sha256", appSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyDashboard(token: string | undefined) {
  if (!token) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [kind, exp, sig] = parts;
    if (kind !== "dash" || Number(exp) < Date.now()) return false;
    const expected = createHmac("sha256", appSecret()).update(`${kind}.${exp}`).digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const DASHBOARD_COOKIE = "fl_dash";

type SqlClient = ReturnType<typeof postgres>;

let sqlClient: SqlClient | null = null;
let schemaReady: Promise<void> | null = null;

function normalizeDatabaseUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HostingConfigError("DATABASE_URL is not a valid Postgres connection string.");
  }
  url.searchParams.delete("channel_binding");
  const host = url.hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  if (!local && !url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "require");
  return url.toString();
}

async function sql() {
  if (!sqlClient) {
    const postgres = (await import("postgres")).default;
    sqlClient = postgres(normalizeDatabaseUrl(databaseUrl()), {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
    });
  }
  if (!schemaReady) {
    const db = sqlClient;
    schemaReady = (async () => {
      await db`CREATE TABLE IF NOT EXISTS designs (
        id text PRIMARY KEY,
        created_at timestamptz NOT NULL,
        payload jsonb NOT NULL
      )`;
      await db`CREATE TABLE IF NOT EXISTS orders (
        id text PRIMARY KEY,
        created_at timestamptz NOT NULL,
        status text NOT NULL,
        stripe_session_id text,
        payload jsonb NOT NULL
      )`;
      await db`CREATE INDEX IF NOT EXISTS orders_session_idx ON orders (stripe_session_id)`;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
  return sqlClient;
}

function asJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

async function saveDesignPg(design: Design) {
  const db = await sql();
  await db`
    INSERT INTO designs (id, created_at, payload)
    VALUES (${design.id}, ${design.createdAt}, ${db.json(design)})
    ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload
  `;
  return design;
}

async function getDesignPg(id: string) {
  const db = await sql();
  const rows = await db<{ payload: Design | string }[]>`SELECT payload FROM designs WHERE id = ${id} LIMIT 1`;
  return rows[0] ? asJson<Design>(rows[0].payload) : null;
}

async function createOrderPg(order: Order) {
  const db = await sql();
  await db`
    INSERT INTO orders (id, created_at, status, stripe_session_id, payload)
    VALUES (${order.id}, ${order.createdAt}, ${order.status}, ${order.stripeSessionId ?? null}, ${db.json(order)})
  `;
  return order;
}

async function updateOrderPg(id: string, patch: (order: Order) => void) {
  const db = await sql();
  return db.begin(async (tx) => {
    const rows = await tx<{ payload: Order | string }[]>`SELECT payload FROM orders WHERE id = ${id} FOR UPDATE`;
    if (!rows[0]) return null;
    const order = asJson<Order>(rows[0].payload);
    patch(order);
    await tx`
      UPDATE orders
      SET payload = ${tx.json(order)}, status = ${order.status}, stripe_session_id = ${order.stripeSessionId ?? null}
      WHERE id = ${id}
    `;
    return order;
  });
}

async function getOrderPg(id: string) {
  const db = await sql();
  const rows = await db<{ payload: Order | string }[]>`SELECT payload FROM orders WHERE id = ${id} LIMIT 1`;
  return rows[0] ? asJson<Order>(rows[0].payload) : null;
}

async function listOrdersPg() {
  const db = await sql();
  const rows = await db<{ payload: Order | string }[]>`SELECT payload FROM orders ORDER BY created_at DESC`;
  return rows.map((row) => asJson<Order>(row.payload));
}

async function findOrderBySessionPg(sessionId: string) {
  const db = await sql();
  const rows = await db<{ payload: Order | string }[]>`
    SELECT payload FROM orders WHERE stripe_session_id = ${sessionId} LIMIT 1
  `;
  return rows[0] ? asJson<Order>(rows[0].payload) : null;
}
