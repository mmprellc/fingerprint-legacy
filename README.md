# Fingerprint Legacy

A self-serve studio for turning a real fingerprint into heirloom art. Every ridge is set in words the customer supplies — names, places, dates, verses — and the paid order goes straight to a digital download or to Printful. No one on the business side has to touch the file.

The working name is **Fingerprint Legacy**. The alternate name is **The Dash**. Both appear in the header and footer; change the wordmark in `components/site-header.tsx` when one of them is chosen for good.

## What a customer can do

1. Open the studio, upload a fingerprint (or use the phone camera), and add the words.
2. Choose type, a color preset, ink, paper, density, size, and a format.
3. Add a second print when the piece is for two people. The two patterns are placed together and turned slightly toward each other.
4. Pay. A digital order can be downloaded as SVG, PDF, and a high-resolution PNG. A physical order is sent to Printful with the shipping address.

If `STRIPE_SECRET_KEY` or `PRINTFUL_API_KEY` is missing, that step runs in mock mode so the whole path still completes.

## Run it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The studio starts from a sample print so you can see a finished piece immediately.

```bash
npm test
npm run build
```

`npm run generate:samples` rebuilds the gallery photographs and the sample prints in `public/`.

## Environment

Copy `.env.example` to `.env.local`.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Absolute origin used in Stripe return URLs and download links. |
| `STRIPE_SECRET_KEY` | Server key. Prefer a restricted test key (`rk_test_…`) with permission to create Checkout Sessions and read them back. Leave empty to use mock checkout. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `POST /api/webhooks/stripe`. Required before live payments. The handler verifies the signature, then fulfills on `checkout.session.completed` and `checkout.session.async_payment_succeeded` when `payment_status` is not `unpaid`. It also records `checkout.session.async_payment_failed`. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Not used by the hosted Checkout page. Reserved if you later embed a payment element. |
| `PRINTFUL_API_KEY` | Sends the PNG to Printful and creates the order. Empty means a mock Printful id is stored instead. |
| `PRINTFUL_AUTO_CONFIRM` | `true` (default) submits the Printful order. `false` leaves a draft. A confirmed order can charge the Printful wallet. |
| `PRINTFUL_VARIANT_ARCHIVAL_8X10` and the same pattern for `11X14`, `16X20`, and `FRAMED_*` | Optional catalog variant overrides. Defaults are enhanced matte posters `4463`, `14125`, `3877` and black frames `4651`, `14292`, `4399`. |
| `DASHBOARD_SECRET` | Password for `/dashboard`. In development, until this is set, the password is `legacy-demo`. Production refuses to sign in without it. |
| `RESEND_API_KEY` and `EMAIL_FROM` | Optional. Digital orders always save a receipt note on the order; with a Resend key they are emailed too. |

Stripe webhooks are how paid orders are fulfilled when the customer never returns to the site. For local test mode, the success page also retrieves the Checkout Session and fulfills if it is paid, so you can try a test card without the CLI. Before launch, point a webhook endpoint at `/api/webhooks/stripe`.

Fulfillment reads the shipping address from the Checkout Session (`collected_information.shipping_details`). Do not turn on Stripe Tax unless you have an active registration — this app does not enable `automatic_tax`.

## Brand colors

The site palette lives in one place: the `:root` variables at the top of `app/globals.css`.

```css
:root {
  --paper: #f4efe6;
  --paper-raised: #fbf7f1;
  --ink: #1c1916;
  --ink-soft: #3c352e;
  --muted: #6f655b;
  --line: #e0d6c8;
  --accent: #7a5638;
  --accent-soft: #c6a07a;
  --sage: #2c4036;
}
```

Change those and the marketing pages follow. The fingerprint itself uses separate presets (Ivory, Midnight, Blush, Forest, Navy, Gilded) in `lib/catalog.ts` under `PALETTES`. Customers can also pick ink and paper directly. Those presets are the product, not the site chrome.

The placeholder palette is warm paper and walnut. Replace it with the owner's colors when they arrive; you should not need to touch component files.

## How the print is made

`lib/fingerprint/extract.ts` reads the photograph, corrects the lighting, estimates the ridge direction, and traces smooth lines that follow the print. `lib/fingerprint/render.ts` sets the words along those lines as outlined glyphs, so the SVG does not depend on a printer having the font. A light stroke sits under the letters so the shape still reads as a fingerprint from across the room.

The server writes three files per order, under `data/files/<id>/`:

- `artwork.svg` — vector master
- `artwork.png` — about 300 DPI for 8×10, 260 for 11×14, 220 for 16×20
- `artwork.pdf` — that image on a page of the ordered size

The owner dashboard at `/dashboard` lists every order, the payment mode, and the Printful status. A failed print submission can be retried there.

## Wrapping it later

The app is a responsive Next.js site with a web manifest, icons, and a small service worker (registered in production). The studio is one screen: preview, then controls. Camera capture uses `getUserMedia` with a file input fallback (`capture="environment"`). That structure is what a later iOS or Android wrapper would host.

## Orders on disk

Orders are stored in `data/orders.json`. That file is gitignored. It is enough for a single server. Move it to a database before running more than one instance.
