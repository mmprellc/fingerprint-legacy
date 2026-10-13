import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Questions" };

const faqs = [
  ["What kind of photo works?", "A clear fingerprint, ridges darker or lighter than the paper, filling most of the frame. An inked card is the surest. You can also use the phone camera in the studio."],
  ["Who edits the portrait?", "No one. The studio extracts the ridges and sets your words along them. If a photo is too soft, it will say so rather than invent lines."],
  ["Can two people share a piece?", "Yes. Add a second print in the studio. Each keeps its own words, and you can overlap them."],
  ["What do I receive?", "A digital order includes SVG, PDF, and PNG. Printed orders are sent to Printful with your address after payment. In this prototype, Printful is simulated until an API key is set."],
  ["Can this become jewelry?", "The file is prepared for it. Pendants, urns, and other objects are in the catalog and are not for sale until a partner is connected."],
];

export default function FaqPage() {
  return (
    <article className="page">
      <p className="kicker">Questions</p>
      <h1>Before you begin.</h1>
      <div className="stack">
        {faqs.map(([question, answer]) => (
          <details key={question} open>
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
        <p><Link className="btn-gold" href="/studio">Begin in the studio</Link></p>
      </div>
    </article>
  );
}
