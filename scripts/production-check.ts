import { secretKeyMode, publishableKeyMode, checkoutBlockedReason } from "../lib/stripe";
import { databaseUrl, storageKind, webhookUrl, isProductionDeploy, requiresDurableStorage } from "../lib/runtime";
import { dashboardConfigError } from "../lib/store";

type Row = { name: string; ok: boolean; detail: string };

function present(name: string) {
  return Boolean((process.env[name] || "").trim());
}

function main() {
  const production = process.argv.includes("--production") || isProductionDeploy();
  const rows: Row[] = [
    { name: "DATABASE_URL", ok: Boolean(databaseUrl()), detail: databaseUrl() ? "postgres" : "missing — development uses data/ on disk" },
    {
      name: "object storage",
      ok: storageKind() !== "disk",
      detail: storageKind() === "disk" ? "missing — development keeps files in data/" : storageKind(),
    },
    { name: "STRIPE_SECRET_KEY", ok: secretKeyMode() !== "unset", detail: secretKeyMode() },
    { name: "STRIPE_PUBLISHABLE_KEY", ok: publishableKeyMode() !== "unset", detail: publishableKeyMode() },
    { name: "STRIPE_WEBHOOK_SECRET", ok: present("STRIPE_WEBHOOK_SECRET"), detail: present("STRIPE_WEBHOOK_SECRET") ? "set" : "missing" },
    { name: "PUBLIC_BASE_URL", ok: present("PUBLIC_BASE_URL"), detail: present("PUBLIC_BASE_URL") ? webhookUrl() : "webhook path /api/webhooks/stripe" },
    { name: "PRINTFUL_API_KEY", ok: present("PRINTFUL_API_KEY"), detail: present("PRINTFUL_API_KEY") ? "live" : "prints stay unsent" },
    { name: "PRINTFUL_STORE_ID", ok: present("PRINTFUL_STORE_ID"), detail: present("PRINTFUL_STORE_ID") ? "set" : "missing" },
    { name: "PRINTFUL_VARIANT_ARCHIVAL", ok: present("PRINTFUL_VARIANT_ARCHIVAL"), detail: present("PRINTFUL_VARIANT_ARCHIVAL") ? "set" : "missing" },
    { name: "framed poster variants", ok: true, detail: "black, white, and red oak at 8×10, 11×14, and 16×20, from Printful product 2. Override with PRINTFUL_VARIANT_FRAME_<FINISH>_<SIZE>" },
    {
      name: "DASHBOARD_PASSWORD",
      ok: present("DASHBOARD_PASSWORD"),
      detail: present("DASHBOARD_PASSWORD") ? "set" : production || requiresDurableStorage() ? "required" : "development default dev-legacy",
    },
    { name: "APP_SECRET", ok: (process.env.APP_SECRET || "").trim().length >= 24, detail: (process.env.APP_SECRET || "").trim().length >= 24 ? "set" : "needs at least 24 characters" },
    { name: "RESEND_API_KEY", ok: present("RESEND_API_KEY") && present("EMAIL_FROM"), detail: present("RESEND_API_KEY") && present("EMAIL_FROM") ? "resend" : "optional — email is stored on the order" },
  ];

  console.log(production ? "Production check" : "Environment check (development)");
  for (const row of rows) {
    console.log(`${row.ok ? "ok  " : "miss"}  ${row.name} — ${row.detail}`);
  }
  const blocked = checkoutBlockedReason();
  const dashboard = dashboardConfigError();
  if (blocked) console.log(`block  checkout — ${blocked}`);
  if (dashboard) console.log(`block  dashboard — ${dashboard}`);

  if (!production) {
    console.log("Pass --production to fail when a live-site value is missing.");
    return;
  }

  const required = [
    "DATABASE_URL",
    "object storage",
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "PUBLIC_BASE_URL",
    "DASHBOARD_PASSWORD",
    "APP_SECRET",
  ];
  const missing = rows.filter((row) => required.includes(row.name) && !row.ok);
  const stripeLive = secretKeyMode() === "live" && publishableKeyMode() === "live";
  const printMissing = rows.filter((row) => row.name.startsWith("PRINTFUL_") && !row.ok);
  if (!stripeLive) console.log("block  stripe — production needs rk_live_… and pk_live_…");
  if (printMissing.length) {
    console.log(`note   prints will not ship until ${printMissing.map((row) => row.name).join(", ")} are set`);
  }
  if (missing.length || !stripeLive || blocked || dashboard) {
    process.exitCode = 1;
  }
}

main();
