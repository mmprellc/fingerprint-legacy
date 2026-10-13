import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { keepsakeBySlug, keepsakes } from "@/lib/content";

export function generateStaticParams() {
  return keepsakes.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: keepsakeBySlug(slug)?.title ?? "Keepsake" };
}

export default async function KeepsakePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = keepsakeBySlug(slug);
  if (!item) notFound();
  return (
    <article className="page">
      <p className="kicker">Keepsake</p>
      <h1>{item.title}</h1>
      <p className="lede">{item.lede}</p>
      <div className="stack">
        <p>{item.body}</p>
        <p>
          <Link className="btn-gold" href="/studio">Create the portrait</Link>{" "}
          <Link className="btn-ghost" href="/pricing">See what you can order now</Link>
        </p>
      </div>
    </article>
  );
}
