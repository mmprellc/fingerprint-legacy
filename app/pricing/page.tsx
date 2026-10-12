import type { Metadata } from "next";
import Link from "next/link";
import { FORMATS, SIZES, money, type FormatId, type SizeId } from "@/lib/catalog";

export const metadata: Metadata = { title: "Pricing" };

const sizes = Object.keys(SIZES) as SizeId[];
const formats = Object.keys(FORMATS) as FormatId[];

export default function PricingPage() {
  return (
    <main className="wrap" style={{ padding: "36px 0 72px" }}>
      <p className="eyebrow">Formats & pricing</p>
      <h1>The file, the print, or the framed piece.</h1>
      <p className="lede">
        Digital orders include the vector SVG, a PDF, and a high-resolution PNG. Physical orders are enhanced matte
        posters, printed after payment and shipped to the address you give. Prices are in US dollars.
      </p>
      <div className="table-wrap" style={{ marginTop: 28 }}>
        <table>
          <thead>
            <tr>
              <th>Format</th>
              {sizes.map((size) => (
                <th key={size}>{SIZES[size].label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {formats.map((formatId) => (
              <tr key={formatId}>
                <td>
                  <strong>{FORMATS[formatId].name}</strong>
                  <div style={{ color: "var(--muted)" }}>{FORMATS[formatId].summary}</div>
                </td>
                {sizes.map((size) => (
                  <td key={size}>{money(FORMATS[formatId].prices[size])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cards" style={{ marginTop: 22 }}>
        <article className="card">
          <h3>What “print-ready” means</h3>
          <p>The SVG is outlined type, so a press does not need the font installed. The PNG is rasterized around 220–300 DPI for the size you chose. The PDF is that image, page-sized.</p>
        </article>
        <article className="card">
          <h3>What happens after you pay</h3>
          <p>Digital files are ready on the confirmation page and saved as a note to email. Prints are sent to Printful with your shipping address. If Printful is not connected yet, the order is recorded as a mock so you can still walk the whole path.</p>
        </article>
      </div>
      <p style={{ marginTop: 22 }}>
        <Link className="btn" href="/studio">
          Start a piece
        </Link>
      </p>
    </main>
  );
}
