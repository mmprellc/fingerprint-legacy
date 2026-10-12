import type { Metadata } from "next";
import { occasionBySlug, occasions } from "@/lib/content";
import { pieceBySlug } from "@/lib/pieces";
import { productById } from "@/lib/products";
import { StudioClient } from "./studio-client";

export const metadata: Metadata = { title: "Studio" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const occasionSlug = typeof params.occasion === "string" ? params.occasion : "";
  const occasion = occasionBySlug(occasionSlug);
  const pieceSlug = typeof params.piece === "string" ? params.piece : "";
  const piece = pieceBySlug(pieceSlug);
  const product = typeof params.product === "string" && productById(params.product).available ? params.product : "digital";
  const couple = !piece && (params.couple === "1" || Boolean(occasion?.couple && params.sample !== "1"));
  const autoload = Boolean(piece) || params.sample === "1" || Boolean(occasion && !couple);
  return (
    <article className="page">
      <p className="kicker">Studio</p>
      <h1>Shape the portrait yourself.</h1>
      <p className="lede">The ridges stay faithful to the print. Your words do the inking.</p>
      {piece ? <p className="note studio-note">The ridges below are read from the print. The names and verses follow those lines.</p> : null}
      <StudioClient
        initialOccasion={occasion}
        initialPiece={piece}
        initialProduct={product}
        autoload={autoload && !couple}
        couple={couple}
        occasions={occasions}
      />
    </article>
  );
}
