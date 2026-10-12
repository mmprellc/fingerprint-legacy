import type { Metadata } from "next";
import { Studio } from "@/components/studio";

export const metadata: Metadata = { title: "Studio" };

export default function StudioPage() {
  return (
    <main>
      <div className="wrap" style={{ paddingTop: 28 }}>
        <p className="eyebrow">Studio</p>
        <h1 style={{ fontSize: "clamp(40px, 6vw, 64px)" }}>Compose the piece.</h1>
        <p className="lede">The preview is what prints. Change a word and the ridges change with it.</p>
      </div>
      <Studio />
    </main>
  );
}
