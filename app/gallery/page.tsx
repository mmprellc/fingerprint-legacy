import type { Metadata } from "next";
import Link from "next/link";
import { galleryPieces } from "@/lib/content";

export const metadata: Metadata = { title: "Gallery" };

export default function GalleryPage() {
  return (
    <article className="page">
      <p className="kicker">Gallery</p>
      <h1>Portraits made only of ridges and words.</h1>
      <p className="lede">These pieces were read from sample prints in the studio. The same path is open for a photograph of your own.</p>
      <div className="gallery-grid">
        {galleryPieces.map((piece) => (
          <Link key={piece.slug} href={`/gallery/${piece.slug}`} className="gallery-card">
            <img src={piece.image} alt={piece.title} />
            <figcaption>
              <strong>{piece.title}</strong>
              <p>{piece.caption}</p>
            </figcaption>
          </Link>
        ))}
      </div>
      <p><Link className="btn-gold" href="/studio">Open the studio</Link></p>
    </article>
  );
}
