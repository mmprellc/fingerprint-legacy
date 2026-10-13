import type { Metadata } from "next";
import Link from "next/link";
import { steps } from "@/lib/content";

export const metadata: Metadata = { title: "How it works" };

const anchors = ["upload", "words", "shape", "receive"];

export default function HowItWorksPage() {
  return (
    <article className="page">
      <p className="kicker">How it works</p>
      <h1>Four steps, and then it is yours.</h1>
      <p className="lede">A seamless, private process. The business never opens the file to tidy a ridge or rewrite a line.</p>
      <div className="stack">
        {steps.map((step, index) => (
          <section key={step.n} id={anchors[index]} className="info-block">
            <b>{step.n}</b>
            <h2>{step.title}</h2>
            <p>{step.body}</p>
          </section>
        ))}
        <p>The portrait can be a digital file, an archival print, or a framed print. Jewelry and other keepsakes use that same file when a production partner is connected.</p>
        <p>
          <Link className="btn-gold" href="/studio">Begin in the studio</Link>{" "}
          <Link className="btn-ghost" href="/pricing">See pricing</Link>
        </p>
      </div>
    </article>
  );
}
