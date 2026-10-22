/**
 * Chrome does not match an IP address against form-action 'self', and it also
 * ignores an explicit http://127.0.0.1 source. Loopback dev hosts allow form
 * posts. A public host stays limited to this site and Stripe.
 */
export function contentSecurityPolicy(origin: { host: string }) {
  const hostname = origin.host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const formAction = loopback ? "form-action *" : "form-action 'self' https://*.stripe.com";
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.stripe.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.stripe.com https://*.public.blob.vercel-storage.com https://*.private.blob.vercel-storage.com",
    "font-src 'self' data:",
    "connect-src 'self' https://*.stripe.com https://api.stripe.com",
    "frame-src https://*.stripe.com https://*.stripe.network",
    "object-src 'none'",
    "base-uri 'self'",
    formAction,
  ].join("; ");
}
