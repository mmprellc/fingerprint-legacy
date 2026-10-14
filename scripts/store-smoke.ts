import { createOrder, getDesign, getOrder, joinLaunchList, listLaunchSignups, saveDesign, savePreview, updateOrder } from "../lib/store";
import { openFile, previewObjectKey } from "../lib/files";
import { checkoutBlockedReason, isPrelaunch, publishableKeyMode, secretKeyMode } from "../lib/stripe";
import { dashboardConfigError, dashboardPassword, dashboardUsesDefaultPassword } from "../lib/store";

async function main() {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.BLOB_READ_WRITE_TOKEN || process.env.S3_BUCKET) {
    throw new Error("Unset DATABASE_URL, POSTGRES_URL, BLOB_READ_WRITE_TOKEN, and S3_BUCKET before the disk smoke.");
  }
  const design = await saveDesign({
    id: "dsn_aabbccddeeff001122",
    createdAt: new Date().toISOString(),
    prints: [],
    style: { font: "cormorant", preset: "ink", textScale: 1, title: "", script: "" },
    period: 12,
    productId: "digital",
    sizeId: "natural",
  });
  await savePreview(design.id, Buffer.from("png"));
  const loaded = await getDesign(design.id);
  if (!loaded || loaded.productId !== "digital") throw new Error("design roundtrip failed");
  const preview = await openFile(previewObjectKey(design.id)!);
  if (!preview || preview.kind !== "bytes" || preview.body.toString() !== "png") throw new Error("preview roundtrip failed");
  const order = await createOrder({
    email: "owner@example.com",
    productId: "digital",
    sizeId: "natural",
    amountCents: 6400,
    checkout: "mock",
    designId: design.id,
  });
  await updateOrder(order.id, (current) => {
    current.status = "paid";
    current.stripeSessionId = "cs_test_smoke";
  });
  const again = await getOrder(order.id);
  if (!again || again.status !== "paid" || again.stripeSessionId !== "cs_test_smoke") throw new Error("order roundtrip failed");
  const signup = await joinLaunchList({
    email: "Owner@Example.com",
    designId: design.id,
    productId: "framed",
    sizeId: "11x14",
    frameId: "oak",
  });
  const signups = await listLaunchSignups();
  if (!signups.some((item) => item.id === signup.id && item.email === "owner@example.com" && item.frameId === "oak")) {
    throw new Error("launch list roundtrip failed");
  }

  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD,
    APP_SECRET: process.env.APP_SECRET,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  };
  const setEnv = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  try {
    setEnv("NODE_ENV", "development");
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.DASHBOARD_PASSWORD;
    if (dashboardPassword() !== "dev-legacy" || !dashboardUsesDefaultPassword()) throw new Error("dev password");
    setEnv("VERCEL", "1");
    setEnv("VERCEL_ENV", "production");
    setEnv("NODE_ENV", "production");
    if (dashboardPassword() !== "" || dashboardUsesDefaultPassword() || !dashboardConfigError()) {
      throw new Error("production password must be required");
    }
    setEnv("DASHBOARD_PASSWORD", "a-real-password");
    setEnv("APP_SECRET", "x".repeat(32));
    if (dashboardConfigError()) throw new Error("configured dashboard should pass");
    setEnv("STRIPE_SECRET_KEY", undefined);
    setEnv("STRIPE_PUBLISHABLE_KEY", undefined);
    setEnv("STRIPE_WEBHOOK_SECRET", undefined);
    if (checkoutBlockedReason() || !isPrelaunch()) throw new Error("production without stripe should be pre-launch");
    setEnv("STRIPE_SECRET_KEY", "rk_test_example");
    setEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_example");
    setEnv("STRIPE_WEBHOOK_SECRET", "whsec_example");
    if (secretKeyMode() !== "test" || !checkoutBlockedReason()?.includes("rk_live_")) throw new Error("test keys must not pass production");
    setEnv("STRIPE_SECRET_KEY", "rk_live_example");
    setEnv("STRIPE_PUBLISHABLE_KEY", "pk_live_example");
    if (publishableKeyMode() !== "live" || checkoutBlockedReason()) throw new Error("live keys should pass");
  } finally {
    for (const [key, value] of Object.entries(saved)) setEnv(key, value);
  }
  console.log("store smoke ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
