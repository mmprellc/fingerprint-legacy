import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { galleryBySlug, galleryPieces, occasionBySlug } from "@/lib/content";

export function generateStaticParams() {
  return galleryPieces.map((piece) => ({ slug: piece.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: galleryBySlug(slug)?.title ?? "Gallery" };
}

export default async function GalleryPiecePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const piece = galleryBySlug(slug);
  if (!piece) notFound();
  const occasion = occasionBySlug(piece.occasion);
  const href = piece.studio ?? `/studio?occasion=${piece.occasion}${piece.couple ? "&couple=1" : "&sample=1"}`;
  return (
    <article className="page">
      <p className="kicker">Gallery</p>
      <h1>{piece.title}</h1>
      <div className="split">
        <img src={piece.image} alt={piece.title} />
        <div className="stack">
          <p className="lede">{piece.caption}</p>
          {piece.compare ? (
            <figure>
              <img src={piece.compare} alt="The original sample fingerprint beside this word-filled portrait" />
              <figcaption className="note">The sample print, and the same ridges carrying the names and verses.</figcaption>
            </figure>
          ) : null}
          {piece.closeup ? (
            <figure>
              <img src={piece.closeup} alt="A close view of the names and scripture along the ridges" />
              <figcaption className="note">Closer in, the ridges read as names and scripture.</figcaption>
            </figure>
          ) : null}
          {piece.slug === "memorial" ? (
            <figure>
              <img src="/samples/side-by-side.png" alt="The original sample fingerprint beside the word-filled portrait" />
              <figcaption className="note">The inked print, and the same ridges rewritten as words.</figcaption>
            </figure>
          ) : null}
          <p>{occasion?.lede}</p>
          <p>
            <Link className="btn-gold" href={href}>Make a piece like this</Link>{" "}
            {piece.pdf ? <a className="btn-ghost" href={piece.pdf}>Download the PDF</a> : null}{" "}
            <Link className="btn-ghost" href={`/occasions/${piece.occasion}`}>About this occasion</Link>
          </p>
          <p><Link href="/gallery">Back to the gallery</Link></p>
        </div>
      </div>
    </article>
  );
}
