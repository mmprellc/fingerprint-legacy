import type { Metadata } from "next";
import Link from "next/link";
import { occasions } from "@/lib/content";

export const metadata: Metadata = { title: "Occasions" };

export default function OccasionsPage() {
  return (
    <article className="page">
      <p className="kicker">Occasions of honor</p>
      <h1>For every chapter that should be kept.</h1>
      <div className="cards">
        {occasions.map((occasion) => (
          <Link key={occasion.slug} className="card" href={`/occasions/${occasion.slug}`}>
            <p className="kicker">{occasion.kicker}</p>
            <h2>{occasion.title}</h2>
            <p>{occasion.lede}</p>
          </Link>
        ))}
      </div>
    </article>
  );
}
