import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { occasionBySlug, occasions } from "@/lib/content";

export function generateStaticParams() {
  return occasions.map((occasion) => ({ slug: occasion.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const occasion = occasionBySlug(slug);
  return { title: occasion?.title ?? "Occasion" };
}

export default async function OccasionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const occasion = occasionBySlug(slug);
  if (!occasion) notFound();
  const href = `/studio?occasion=${occasion.slug}${occasion.couple ? "&couple=1" : "&sample=1"}`;
  return (
    <article className="page">
      <p className="kicker">{occasion.kicker}</p>
      <h1>{occasion.title}</h1>
      <p className="lede">{occasion.lede}</p>
      <div className="split">
        <div className="stack">
          {occasion.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          <p>
            <Link className="btn-gold" href={href}>Start this piece</Link>{" "}
            <Link className="btn-ghost" href="/pricing">Choose a format</Link>
          </p>
        </div>
        <aside className="info-block">
          <h2>Words to begin with</h2>
          <ul>
            {occasion.lines.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="note">You can replace every line in the studio.</p>
        </aside>
      </div>
    </article>
  );
}
