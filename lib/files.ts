import fs from "node:fs/promises";
import path from "node:path";
import { HostingConfigError, blobToken, requiresDurableStorage, s3Settings, storageKind, type StorageKind } from "./runtime";

const KEY = /^(designs|orders)\/(?:dsn|ord)_[a-f0-9]+\/[a-z0-9.]+$/;

export function previewObjectKey(id: string) {
  if (!/^dsn_[a-f0-9]+$/.test(id)) return null;
  return `designs/${id}/preview.png`;
}

const orderNames: Record<string, string> = {
  svg: "portrait.svg",
  png: "portrait.png",
  pdf: "portrait.pdf",
  zip: "portrait.zip",
};

export function orderObjectKey(id: string, kind: string) {
  if (!/^ord_[a-f0-9]+$/.test(id)) return null;
  const name = orderNames[kind];
  if (!name) return null;
  return `orders/${id}/${name}`;
}

export function contentTypeForKind(kind: string) {
  const types: Record<string, string> = {
    svg: "image/svg+xml",
    png: "image/png",
    pdf: "application/pdf",
    zip: "application/zip",
  };
  return types[kind] ?? null;
}

export type OpenedFile = { kind: "bytes"; body: Buffer } | { kind: "redirect"; url: string };

function assertStorage(): StorageKind {
  const kind = storageKind();
  if (kind === "disk" && requiresDurableStorage()) {
    throw new HostingConfigError(
      "Set BLOB_READ_WRITE_TOKEN (Vercel Blob) or S3_BUCKET with S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY. This host has no durable disk.",
    );
  }
  return kind;
}

function diskPath(key: string) {
  if (!KEY.test(key)) throw new HostingConfigError("Invalid stored file.");
  const [, id, name] = key.split("/");
  if (key.startsWith("designs/")) return path.join(process.cwd(), "data", "designs", id, name);
  return path.join(process.cwd(), "data", "files", id, name);
}

export async function putBytes(key: string, body: Buffer, contentType: string) {
  const kind = assertStorage();
  if (!KEY.test(key)) throw new HostingConfigError("Invalid stored file.");
  if (kind === "blob") return putBlob(key, body, contentType);
  if (kind === "s3") return putS3(key, body, contentType);
  const file = diskPath(key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}

export async function openFile(key: string): Promise<OpenedFile | null> {
  const kind = assertStorage();
  if (!KEY.test(key)) return null;
  if (kind === "disk") {
    try {
      return { kind: "bytes", body: await fs.readFile(diskPath(key)) };
    } catch {
      return null;
    }
  }
  const url = await signedFileUrl(key, 30 * 60);
  return url ? { kind: "redirect", url } : null;
}

/** A URL Printful or a browser can fetch without a bearer token. Null on the local disk. */
export async function signedFileUrl(key: string, seconds: number): Promise<string | null> {
  const kind = assertStorage();
  if (!KEY.test(key)) return null;
  if (kind === "blob") return blobSignedGet(key, seconds);
  if (kind === "s3") return s3SignedGet(key, seconds);
  return null;
}

async function putBlob(key: string, body: Buffer, contentType: string) {
  const { put } = await import("@vercel/blob");
  await put(key, body, {
    access: "private",
    token: blobToken(),
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60 * 60,
  });
}

async function blobSignedGet(key: string, seconds: number) {
  const { issueSignedToken, presignUrl } = await import("@vercel/blob");
  const validUntil = Date.now() + seconds * 1000;
  const issued = await issueSignedToken({
    token: blobToken(),
    pathname: key,
    operations: ["get"],
    validUntil,
  });
  const signed = await presignUrl(issued, { access: "private", operation: "get", pathname: key, validUntil });
  return signed.presignedUrl;
}

function s3Client() {
  const settings = s3Settings();
  if (!settings) throw new HostingConfigError("S3 is not configured.");
  return settings;
}

async function putS3(key: string, body: Buffer, contentType: string) {
  const settings = s3Client();
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: settings.region,
    endpoint: settings.endpoint,
    forcePathStyle: settings.forcePathStyle,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
  });
  await client.send(new PutObjectCommand({ Bucket: settings.bucket, Key: key, Body: body, ContentType: contentType }));
}

async function s3SignedGet(key: string, seconds: number) {
  const settings = s3Client();
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const client = new S3Client({
    region: settings.region,
    endpoint: settings.endpoint,
    forcePathStyle: settings.forcePathStyle,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
  });
  const filename = key.split("/").pop() || "portrait";
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: settings.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    }),
    { expiresIn: seconds },
  );
}
