import type { Metadata } from "next";
import { occasionBySlug, occasions } from "@/lib/content";
import { productById } from "@/lib/products";
import { StudioClient } from "./studio-client";

export const metadata: Metadata = { title: "Studio" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const occasionSlug = typeof params.occasion === "string" ? params.occasion : "";
  const occasion = occasionBySlug(occasionSlug);
  const product = typeof params.product === "string" && productById(params.product).available ? params.product : "digital";
  const couple = params.couple === "1" || Boolean(occasion?.couple && params.sample !== "1");
  const autoload = params.sample === "1" || Boolean(occasion && !couple);
  return (
    <article className="page">
      <p className="kicker">Studio</p>
      <h1>Shape the portrait yourself.</h1>
      <p className="lede">The ridges stay faithful to the print. Your words do the inking.</p>
      <StudioClient
        initialOccasion={occasion}
        initialProduct={product}
        autoload={autoload && !couple}
        couple={couple}
        occasions={occasions}
      />
    </article>
  );
}
