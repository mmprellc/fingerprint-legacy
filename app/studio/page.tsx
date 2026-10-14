import type { Metadata } from "next";
import { occasionBySlug, occasions } from "@/lib/content";
import { pieceBySlug } from "@/lib/pieces";
import { isFrameFinish } from "@/lib/frames";
import { productById } from "@/lib/products";
import { paymentsMode } from "@/lib/fulfill";
import { StudioClient } from "./studio-client";

export const metadata: Metadata = { title: "Studio" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const occasionSlug = typeof params.occasion === "string" ? params.occasion : "";
  const occasion = occasionBySlug(occasionSlug);
  const pieceSlug = typeof params.piece === "string" ? params.piece : "";
  const piece = pieceBySlug(pieceSlug);
  const product = typeof params.product === "string" && productById(params.product).available ? params.product : "digital";
  const frame = typeof params.frame === "string" && isFrameFinish(params.frame) ? params.frame : "black";
  const couple = !piece && (params.couple === "1" || Boolean(occasion?.couple && params.sample !== "1"));
  const autoload = Boolean(piece) || params.sample === "1" || Boolean(occasion && !couple);
  return (
    <article className="page">
      <p className="kicker">Studio</p>
      <h1>Shape the portrait yourself.</h1>
      <p className="lede">The ridges stay faithful to the print. Your words do the inking.</p>
      {piece ? <p className="note studio-note">The ridges below are read from the print. The center dedication follows the innermost loop, the next dedication the ridges just outside it, and each verse runs whole across the ridges that follow.</p> : null}
      <StudioClient
        initialOccasion={occasion}
        initialPiece={piece}
        initialProduct={product}
        initialFrame={frame}
        autoload={autoload && !couple}
        couple={couple}
        occasions={occasions}
        sampleLettering={params.sample === "1" && !piece}
        waitlist={paymentsMode() === "waitlist"}
      />
    </article>
  );
}
