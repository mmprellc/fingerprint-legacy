# Fingerprint Legacy

People leave fingerprints. Love leaves a legacy.

A self-serve studio that turns a real fingerprint into a portrait: every ridge is a line of the words a customer provides. They upload the print, shape the piece, pay, and the file is ready. Printed orders are handed to Printful. Nobody on the business side retouches a ridge.

The Dash is the short name.

## Run it

```bash
npm install
npm run generate-samples   # sample prints, gallery, icons
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Production:

```bash
npm run build
npm start
```

The owner dashboard password in this prototype, until you set one, is `dev-legacy`. The sign-in page shows it.

## Click through

1. Home, How it works, Occasions, Gallery, Pricing, and the keepsake pages.
2. Studio → **Try the sample print** (or upload a photo, or use the camera).
3. **Continue to checkout**. With no Stripe key this is a test checkout: no card is charged.
4. **Place test order**. The confirmation page has the PNG, SVG, and PDF.
5. Footer → **Owner dashboard** → password `dev-legacy`. The order is listed with its status.

A physical format (archival or framed) asks for a shipping address and records a mock Printful order. Set `PRINTFUL_API_KEY` when you want a real one.

## Environment

Copy `.env.example` to `.env.local`.

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Restricted key (`rk_test_…`) for Stripe test mode. When unset, checkout is the built-in test page. |
| `STRIPE_WEBHOOK_SECRET` | Verifies `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Fulfillment runs from those events, and only when `payment_status` is not `unpaid`. |
| `PRINTFUL_API_KEY` | When unset, print orders are mocked. |
| `PRINTFUL_STORE_ID` | Optional `X-PF-Store-Id`. |
| `PRINTFUL_VARIANT_ARCHIVAL` | Catalog variant id for the archival print. |
| `PRINTFUL_VARIANT_FRAMED` | Catalog variant id for the framed print. |
| `PUBLIC_BASE_URL` | Public origin Printful uses to fetch the PNG. Required for a live print order. |
| `RESEND_API_KEY` and `EMAIL_FROM` | Optional. Without them, the email is stored on the order and the download is on the confirmation page. |
| `DASHBOARD_PASSWORD` | Owner password. Defaults to `dev-legacy`. |
| `APP_SECRET` | Signs the dashboard cookie. |

Store Stripe and Printful keys in the host’s secret store. Do not commit them. Prefer a restricted Stripe key over a secret key.

Webhook forwarding locally:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Point the endpoint at `/api/webhooks/stripe` in production and allow Stripe’s webhook IPs if the host supports it.

## What a purchase does

- **Digital keepsake** — SVG (glyph outlines, so the shop does not need the font), PDF, and PNG.
- **Archival print / framed print** — the same files, plus a Printful order (or a mock) using the shipping address.
- Jewelry, urns, and custom keepsakes are in the catalog and on the site, and are not charged until a variant is connected.

Orders and files live in `data/` on disk. That is enough for a single Node server. A serverless host such as Vercel does not keep that disk, so a Vercel deploy of this prototype will lose designs and orders between requests. For a durable public site, run `npm run build && npm start` on a small VM (set the env vars above, and set `PUBLIC_BASE_URL` to that VM’s HTTPS origin). Use Vercel only after `lib/store.ts` is replaced with a database and object storage.

A temporary phone link can be made with a Cloudflare quick tunnel pointed at the local server (`cloudflared tunnel --url http://localhost:3000`). That URL dies when the tunnel process stops. It is not a substitute for the VM.

## Ridge engine

`lib/fingerprint/engine.ts` reads a grayscale print: local contrast, ridge orientation, a Gabor filter tuned to the ridge spacing, then centerlines, gap repair, and paths. Words are set along those paths. `npm run prove` checks that horizontal ridges stay horizontal and that a synthetic print is recovered to about a pixel.

## Fonts

Cormorant Garamond (SIL OFL, Catharsis Fonts), Libre Baskerville (SIL OFL, Impallari), and Great Vibes (SIL OFL). Licenses are in `fonts/OFL-*.txt`.

## Phone install

The app is a responsive PWA (`app/manifest.ts`, `public/sw.js`). Add it to the home screen from a phone browser once it is served over HTTPS.
