import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Gallery" };

const pieces = [
  { src: "/gallery/memorial.jpg", title: "Margaret", note: "A memorial loop. Names, years, and the house on Alder." },
  { src: "/gallery/retirement.jpg", title: "Engine 14", note: "A retirement whorl in navy and cream." },
  { src: "/gallery/wedding.jpg", title: "The vows", note: "Two prints, turned slightly toward each other." },
  { src: "/gallery/founder.jpg", title: "King Street", note: "A founder’s arch: the first office, the long table, the rule they kept." },
];

export default function GalleryPage() {
  return (
    <main className="wrap" style={{ padding: "36px 0 72px" }}>
      <p className="eyebrow">Gallery</p>
      <h1>Featured pieces</h1>
      <p className="lede">
        These were composed in the studio from sample prints and sample words, so you can see the range before you bring
        your own. Yours will follow the fingerprint you upload.
      </p>
      <div className="gallery-page">
        {pieces.map((piece) => (
          <figure key={piece.title}>
            <img src={piece.src} alt={piece.note} />
            <figcaption>
              <strong style={{ color: "var(--ink)" }}>{piece.title}</strong>
              <div>{piece.note}</div>
            </figcaption>
          </figure>
        ))}
      </div>
      <p style={{ marginTop: 22 }}>
        <Link className="btn" href="/studio">
          Compose your own
        </Link>
      </p>
    </main>
  );
}
