export type SizeOption = {
  id: string;
  label: string;
  inches: [number, number] | null;
};

export type Product = {
  id: string;
  name: string;
  priceCents: number;
  available: boolean;
  fulfillment: "digital" | "printful";
  category: "digital" | "print" | "framed" | "jewelry" | "keepsake";
  summary: string;
  details: string[];
  sizes: SizeOption[];
  printfulEnv?: "PRINTFUL_VARIANT_ARCHIVAL" | "PRINTFUL_VARIANT_FRAMED";
};

export const products: Product[] = [
  {
    id: "digital",
    name: "Digital keepsake",
    priceCents: 6400,
    available: true,
    fulfillment: "digital",
    category: "digital",
    summary: "The finished portrait as SVG, PDF, and a high-resolution PNG. Yours as soon as the order is paid.",
    details: [
      "Vector SVG, print-ready PDF, and a PNG at roughly 200 pixels per inch",
      "Download from the confirmation page. A copy is emailed when email delivery is configured",
      "Use the same file later for a printer, a frame shop, or a keepsake partner",
    ],
    sizes: [{ id: "natural", label: "Natural proportion", inches: null }],
  },
  {
    id: "archival",
    name: "Archival print",
    priceCents: 14800,
    available: true,
    fulfillment: "printful",
    category: "print",
    printfulEnv: "PRINTFUL_VARIANT_ARCHIVAL",
    summary: "The portrait printed and shipped for you. No one here handles the paper.",
    details: [
      "Produced through Printful after payment and sent to the address you enter",
      "Standard shipping is included in the price",
      "Choose 8×10, 11×14, 12×16, or 16×20 inches",
    ],
    sizes: [
      { id: "8x10", label: "8 × 10 in", inches: [8, 10] },
      { id: "11x14", label: "11 × 14 in", inches: [11, 14] },
      { id: "12x16", label: "12 × 16 in", inches: [12, 16] },
      { id: "16x20", label: "16 × 20 in", inches: [16, 20] },
    ],
  },
  {
    id: "framed",
    name: "Framed print",
    priceCents: 26800,
    available: true,
    fulfillment: "printful",
    category: "framed",
    printfulEnv: "PRINTFUL_VARIANT_FRAMED",
    summary: "The same portrait, in a black, white, or natural wood frame, shipped to the door.",
    details: [
      "Printful’s Enhanced Matte Paper Framed Poster, in black, white, or red oak",
      "The studio shows the piece in the frame before you pay",
      "Choose 8×10, 11×14, or 16×20 inches",
    ],
    sizes: [
      { id: "8x10", label: "8 × 10 in", inches: [8, 10] },
      { id: "11x14", label: "11 × 14 in", inches: [11, 14] },
      { id: "16x20", label: "16 × 20 in", inches: [16, 20] },
    ],
  },
  {
    id: "pendant",
    name: "Pendant",
    priceCents: 0,
    available: false,
    fulfillment: "printful",
    category: "jewelry",
    summary: "A round pendant waiting on a production partner. The portrait file is already the artwork.",
    details: ["Catalog slot for jewelry. Turn it on when a variant id is connected."],
    sizes: [{ id: "round", label: "Round pendant", inches: null }],
  },
  {
    id: "urn",
    name: "Urn",
    priceCents: 0,
    available: false,
    fulfillment: "printful",
    category: "keepsake",
    summary: "An urn whose medallion carries the same ridge portrait.",
    details: ["Catalog slot for a keepsake partner."],
    sizes: [{ id: "standard", label: "Standard", inches: null }],
  },
  {
    id: "custom",
    name: "Custom keepsake",
    priceCents: 0,
    available: false,
    fulfillment: "printful",
    category: "keepsake",
    summary: "A place in the catalog for the next object that can hold the portrait.",
    details: ["Not sold in this version. The studio still makes the artwork."],
    sizes: [{ id: "standard", label: "Standard", inches: null }],
  },
];

export const buyableProducts = products.filter((product) => product.available);

export function productById(id: string) {
  return products.find((product) => product.id === id) ?? products[0];
}

/** The size on this format, or the same size from another format when this one does not sell it. */
export function catalogSize(productId: string, sizeId: string | undefined) {
  const product = productById(productId);
  const own = product.sizes.find((item) => item.id === sizeId);
  if (own) return own;
  for (const candidate of products) {
    const found = candidate.sizes.find((item) => item.id === sizeId);
    if (found) return found;
  }
  return product.sizes[0];
}

/** The size this format actually sells. A borrowed size is only for the on-screen proof. */
export function soldSize(productId: string, sizeId: string | undefined) {
  const product = productById(productId);
  return product.sizes.find((item) => item.id === sizeId) ?? product.sizes[0];
}

export function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

/** Printful catalog ids for the unframed archival poster, by size. */
const ARCHIVAL_VARIANTS = {
  "8x10": 4463,
  "11x14": 14125,
  "12x16": 0,
  "16x20": 3877,
} as const;

export type ArchivalSize = keyof typeof ARCHIVAL_VARIANTS;

export function isArchivalSize(value: string | undefined): value is ArchivalSize {
  return value === "8x10" || value === "11x14" || value === "12x16" || value === "16x20";
}

/** Built-in variant for the size. PRINTFUL_VARIANT_ARCHIVAL_<SIZE> overrides one cell. */
export function archivalVariantId(size: string | undefined) {
  const chosen: ArchivalSize = isArchivalSize(size) ? size : "11x14";
  const override = Number(process.env[`PRINTFUL_VARIANT_ARCHIVAL_${chosen.toUpperCase()}`] || "");
  return override || ARCHIVAL_VARIANTS[chosen];
}
