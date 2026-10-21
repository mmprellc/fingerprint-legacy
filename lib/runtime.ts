/** Hosting signals. Build-time rendering must not treat a missing production env as fatal. */

export function isBuildPhase() {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/**
 * The live site: Vercel Production, or any non-Vercel `next start`.
 * Preview deployments stay on test Stripe keys.
 */
export function isProductionDeploy() {
  if (isBuildPhase()) return false;
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === "production";
  return process.env.NODE_ENV === "production";
}

/** Vercel has no durable disk, and a production process must not fall back to data/. */
export function requiresDurableStorage() {
  if (isBuildPhase()) return false;
  return process.env.VERCEL === "1" || isProductionDeploy();
}

export function databaseUrl() {
  return (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
}

export function blobToken() {
  return (process.env.BLOB_READ_WRITE_TOKEN || "").trim();
}

export type S3Settings = {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
};

export function s3Settings(): S3Settings | null {
  const bucket = (process.env.S3_BUCKET || "").trim();
  const accessKeyId = (process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "").trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  const endpoint = (process.env.S3_ENDPOINT || "").trim();
  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    region: (process.env.S3_REGION || process.env.AWS_REGION || "us-east-1").trim(),
    endpoint: endpoint || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1" || process.env.S3_FORCE_PATH_STYLE === "true",
  };
}

export type StorageKind = "blob" | "s3" | "disk";

export function storageKind(): StorageKind {
  if (blobToken()) return "blob";
  if (s3Settings()) return "s3";
  return "disk";
}

export class HostingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostingConfigError";
  }
}

function safeHost(value: string) {
  return /^[a-z0-9.-]+(?::\d+)?$/i.test(value) || /^\[[0-9a-f:]+\](?::\d+)?$/i.test(value);
}

/** Canonical public origin when set, otherwise the host the browser actually used. */
export function publicOrigin(request: Request) {
  const configured = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  const url = new URL(request.url);
  const host = request.headers.get("host")?.trim() || "";
  if (safeHost(host)) url.host = host;
  return url.origin;
}

export function webhookPath() {
  return "/api/webhooks/stripe";
}

export function webhookUrl(origin?: string) {
  const base = (origin || process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  return base ? `${base}${webhookPath()}` : webhookPath();
}
