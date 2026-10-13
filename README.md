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
2. Studio → **Try the sample print** (or upload a photo, or use the camera). The Randy Czyz piece, read from his ink print, is at `/studio?piece=randy-czyz`, and the same portrait is in the gallery with its PDF.
3. **Continue to checkout**. With no Stripe key this is a test checkout: no card is charged.
4. **Place test order**. The confirmation page has the PNG, SVG, and PDF.
5. Footer → **Owner dashboard** → password `dev-legacy`. The order is listed with its status.

A physical format (archival or framed) asks for a shipping address and records a mock Printful order. Set `PRINTFUL_API_KEY` when you want a real one.

## Environment

Copy `.env.example` to `.env.local`. `npm run production-check` prints which values are missing without showing the secrets. `npm run production-check -- --production` exits non-zero when a live site is incomplete.

Development with nothing set still uses `data/` on disk and the password `dev-legacy`. A Vercel deploy and `next start` refuse that disk and refuse the default password.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Pooled Neon or Vercel Postgres connection string. `POSTGRES_URL` is used only when `DATABASE_URL` is empty. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob, private. Generated files go here when this is set. |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3-compatible store, used when Blob is unset. Optional `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`. |
| `STRIPE_SECRET_KEY` | Live restricted key (`rk_live_…`). When unset, checkout is the built-in test page. Production rejects test keys. |
| `STRIPE_PUBLISHABLE_KEY` | Matching `pk_live_…`. Hosted Checkout does not embed it; the modes still have to match before a charge. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `https://YOUR_DOMAIN/api/webhooks/stripe`. |
| `PRINTFUL_API_KEY` | Printful private token. Production does not invent a mock shipment when this is empty. |
| `PRINTFUL_STORE_ID` | Required with a live token. Sent as `X-PF-Store-Id`. |
| `PRINTFUL_VARIANT_ARCHIVAL` | Catalog variant id for the archival print. |
| `PRINTFUL_VARIANT_FRAME_<FINISH>_<SIZE>` | Optional. Overrides the built-in framed-poster variant for that finish and size. |
| `PUBLIC_BASE_URL` | Canonical origin, no trailing slash. Email links use it. Printful uses a signed file URL when Blob or S3 is set, and this origin otherwise. |
| `RESEND_API_KEY` and `EMAIL_FROM` | Optional. Without them, the email is stored on the order and the download is on the confirmation page. |
| `DASHBOARD_PASSWORD` | Required in production and on Vercel. No default there. |
| `APP_SECRET` | Signs the dashboard cookie. At least 24 characters in production. |

Store keys in the host’s secret store. Do not commit them. Prefer a restricted Stripe key over a secret key. Sales tax is not collected; turn on Stripe Tax only after a registration exists.

Webhook forwarding locally:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

The live endpoint is `https://YOUR_DOMAIN/api/webhooks/stripe`. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed`. Allow Stripe’s webhook IPs if the host supports it.

## What a purchase does

- **Digital keepsake** — SVG (glyph outlines, so the shop does not need the font), PDF, and PNG.
- **Archival print / framed print** — the same files, plus a Printful order (or a mock) using the shipping address. A framed print is Printful’s Enhanced Matte Paper Framed Poster in black, white, or red oak, at 8×10, 11×14, or 16×20. The studio, the pricing page, and checkout show the live artwork inside that frame. With `PRINTFUL_API_KEY` and a public https file (a signed Blob or S3 URL of the portrait), `POST /mockup-generator/create-task/2` replaces the drawing with Printful’s photograph. Without a key, or while the file is only on local disk, the frame stays the local moulding.
- Jewelry, urns, and custom keepsakes are in the catalog and on the site, and are not charged until a variant is connected.

## Go live on Vercel

Orders live in Postgres. Generated previews and print files live in Vercel Blob or S3. `data/` is only the development fallback.

1. Create a [Vercel](https://vercel.com) project from this repo. The plan has to allow a 60 second function: portrait extraction on the regression set takes about 5–14 seconds, and fulfillment renders the SVG, PNG, and PDF after that. The Hobby plan’s 10 second cap will time out. `vercel.json` sets `maxDuration` to 60 on the extract, design, frame-mockup, webhook, and mock-complete routes. If the deploy is rejected for that limit, use the Railway or Render steps below.
2. Create a Postgres database. Either Neon ([neon.tech](https://neon.tech) → New project → Connect → pooled connection string) or Vercel → Storage → Postgres (Neon). Put the pooled string in `DATABASE_URL`. The host should contain `-pooler`. If the string includes `channel_binding`, the app strips it.
3. Create object storage. Vercel → Storage → Blob → connect the project, which sets `BLOB_READ_WRITE_TOKEN`. Or create an S3 bucket (or Cloudflare R2) and set `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`. Files are private. Downloads redirect to a short-lived signed URL so a large PNG is not squeezed through the 4.5 MB function response limit. The studio also shrinks an upload’s long edge toward 1600 pixels before the request, which is the same size the extractor already uses, so a phone photo stays under the 4.5 MB request limit.
4. Stripe, in live mode, with [an authenticator app or a passkey](https://docs.stripe.com/security) on the Dashboard rather than SMS.
   - Developers → API keys → Create restricted key, live mode. Permission: Checkout Sessions, Write. Put it in `STRIPE_SECRET_KEY` (`rk_live_…`).
   - On the same page, copy the publishable key into `STRIPE_PUBLISHABLE_KEY` (`pk_live_…`).
   - Developers → Webhooks → Add endpoint. URL: `https://YOUR_DOMAIN/api/webhooks/stripe`. Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`. Reveal the signing secret into `STRIPE_WEBHOOK_SECRET`.
   - Mark the sensitive variables write-only in Vercel.
5. Printful ([printful.com](https://printful.com)). Settings → API → private token → `PRINTFUL_API_KEY`. The store id is in the dashboard URL or under Stores → `PRINTFUL_STORE_ID`. Set `PRINTFUL_VARIANT_ARCHIVAL` to the unframed poster variant. Framed orders use Enhanced Matte Paper Framed Poster (product 2): black, white, and red oak at 8×10, 11×14, and 16×20. Override one cell with `PRINTFUL_VARIANT_FRAME_<FINISH>_<SIZE>` only if the catalog id changes. Printful fetches a signed URL of the PNG. `PUBLIC_BASE_URL` is the fallback when the file is still on local disk. The same key photographs the frame in the studio when the portrait file is a public https URL.
6. Set `DASHBOARD_PASSWORD` to a long password and `APP_SECRET` to the output of `openssl rand -hex 32`. Set `PUBLIC_BASE_URL` to the canonical `https://` origin with no trailing slash.
7. Redeploy, then run `npm run production-check -- --production` with those variables loaded. Open `/dashboard/login` and confirm the page does not show `dev-legacy`.

Use a separate Neon branch and Stripe test keys for Vercel Preview. Do not point Preview at the production database or the live Stripe keys.

Jewelry, urns, and custom keepsakes stay unavailable until a variant is connected. A failed photo still returns retake instructions and does not become an order.

### Railway or Render

Use this when Vercel Hobby rejects the 60 second functions, or a 16×20 render exceeds that budget. Create a Node web service. Build command `npm run build`. Start command `npm start`. Set the same variables, including `DATABASE_URL` and either Blob or S3. Do not rely on the service disk. Point the Stripe webhook at `https://YOUR_DOMAIN/api/webhooks/stripe` on that host.

A temporary phone link can be made with a Cloudflare quick tunnel pointed at the local server (`cloudflared tunnel --url http://localhost:3000`). That URL dies when the tunnel process stops. It is not a production host.

## Ridge engine

`lib/fingerprint/engine.ts` reads a grayscale print: local contrast, ridge orientation, a Gabor filter tuned to the ridge spacing, then centerlines, gap repair, and paths. Words are set along those paths. `npm run prove` checks that horizontal ridges stay horizontal and that a synthetic print is recovered to about a pixel.

## Fonts

Cormorant Garamond (SIL OFL, Catharsis Fonts), Libre Baskerville (SIL OFL, Impallari), and Great Vibes (SIL OFL). Licenses are in `fonts/OFL-*.txt`.

## Phone install

The app is a responsive PWA (`app/manifest.ts`, `public/sw.js`). Add it to the home screen from a phone browser once it is served over HTTPS.
