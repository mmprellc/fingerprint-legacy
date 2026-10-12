import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FORMATS, money } from "../lib/catalog";
import { extractRidges } from "../lib/fingerprint/extract";
import { renderArtwork } from "../lib/fingerprint/render";
import { renderSyntheticPrint } from "../lib/fingerprint/synthetic";
import { loadTypefaceSync } from "../lib/server/fonts";
import { fulfillPaidOrder } from "../lib/server/fulfill";
import { createOrder, getOrder, orderDir } from "../lib/server/orders";
import { createPrintfulOrder } from "../lib/server/printful";

describe("fingerprint art", () => {
  it("pulls a family of ridges out of a sample print", () => {
    const image = renderSyntheticPrint("loop", 420, 540);
    const ridges = extractRidges(image, { density: 1 });
    expect(ridges.paths.length).toBeGreaterThan(25);
    expect(ridges.spacing).toBeGreaterThan(5);
  });

  it("sets the customer's words into the ridges", () => {
    const image = renderSyntheticPrint("arch", 420, 540);
    const ridges = extractRidges(image);
    const font = loadTypefaceSync("garamond");
    const art = renderArtwork(
      [ridges],
      {
        prints: [{ image, phrases: ["Ada Quinn", "The river house"] }],
        ink: "#1c1916",
        background: "#f4efe6",
        caption: "Ada Quinn",
        artboard: { width: 800, height: 1000 },
      },
      font,
    );
    expect(art.glyphCount).toBeGreaterThan(80);
    expect(art.svg).toContain('fill="#f4efe6"');
    expect(art.svg).toContain("<path");
    expect(art.ridgeCount).toBeGreaterThan(10);
  });
});

describe("catalog", () => {
  it("prices a framed 11 by 14 above the digital file", () => {
    expect(FORMATS.framed.prices["11x14"]).toBeGreaterThan(FORMATS.digital.prices["11x14"]);
    expect(money(7900)).toBe("$79");
  });
});

describe("fulfillment", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fl-orders-"));
  const previous = process.env.ORDERS_DIR;
  const previousKey = process.env.PRINTFUL_API_KEY;

  afterEach(() => {
    process.env.ORDERS_DIR = previous;
    process.env.PRINTFUL_API_KEY = previousKey;
  });

  it("records a mock Printful order when no key is set", async () => {
    process.env.ORDERS_DIR = dir;
    delete process.env.PRINTFUL_API_KEY;
    const id = "order-test";
    const folder = orderDir(id);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "artwork.png"), Buffer.from("png"));
    const order = await createOrder(
      {
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        email: "ada@example.com",
        customerName: "Ada Quinn",
        status: "pending",
        formatId: "archival",
        sizeId: "8x10",
        amountCents: 14800,
        mode: "mock",
        shipping: {
          name: "Ada Quinn",
          address1: "1 Alder Street",
          city: "Portland",
          state: "OR",
          postal: "97201",
          country: "US",
        },
        emailDelivery: "not_required",
        files: {
          svg: path.join(folder, "artwork.svg"),
          png: path.join(folder, "artwork.png"),
          pdf: path.join(folder, "artwork.pdf"),
        },
        summary: "Archival print · 8 × 10 in",
      },
      { svg: "<svg></svg>", png: Buffer.from("png"), pdf: Buffer.from("pdf") },
    );

    const mock = await createPrintfulOrder(order);
    expect(mock.mode).toBe("mock");
    expect(mock.id).toMatch(/^mock_/);

    const done = await fulfillPaidOrder(id, "http://localhost:3000", order.shipping);
    expect(done?.status).toBe("fulfilled");
    expect(done?.printful?.mode).toBe("mock");
    const stored = await getOrder(id);
    expect(stored?.status).toBe("fulfilled");
  });
});
