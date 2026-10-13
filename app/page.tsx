import Link from "next/link";
import { FramedExamples } from "@/components/FramedExamples";
import { galleryPieces, occasions, sentiments, steps } from "@/lib/content";

const virtues = [
  { href: "/how-it-works#upload", label: "Honor their memory", note: "A print, kept as a portrait", icon: "♡" },
  { href: "/how-it-works#words", label: "Keep them close", note: "Words set into the ridges", icon: "∞" },
  { href: "/how-it-works#receive", label: "A legacy that lasts", note: "A file, a print, a frame", icon: "✦" },
];

export default function HomePage() {
  return (
    <>
      <section className="sheet">
        <div className="hero">
          <div>
            <p className="kicker">The Dash</p>
            <h1>A Lasting Connection</h1>
            <p className="lede">Turn the moments you cherish into something you can hold forever.</p>
            <Link className="btn-gold" href="/pricing">Explore our keepsakes <span aria-hidden="true">›</span></Link>
            <ul className="virtues">
              {virtues.map((virtue) => (
                <li key={virtue.href}>
                  <Link href={virtue.href}>
                    <span className="virtue-icon" aria-hidden="true">{virtue.icon}</span>
                    <span>
                      <span className="virtue-label">{virtue.label}</span>
                      <span className="virtue-note">{virtue.note}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="linen">
            <Link href="/gallery/memorial" className="pendant" aria-label="See the memorial portrait">
              <img src="/gallery/memorial.png" alt="A fingerprint portrait of Margaret Hale, formed from words" />
            </Link>
            <p className="script-float">Always with you.</p>
          </div>
        </div>
        <div className="mosaic">
          <Link className="quote" href="/how-it-works">“Their fingerprint lives on in the people they loved.”</Link>
          <Link className="tile" href="/keepsakes/jewelry"><span>Keepsake</span><h3>Jewelry</h3></Link>
          <Link className="tile" href="/keepsakes/urns"><span>Keepsake</span><h3>Urns</h3></Link>
          <Link className="tile" href="/keepsakes/custom"><span>Keepsake</span><h3>Custom keepsakes</h3></Link>
          <Link className="impact" href="/studio">
            <strong>Different people. Same lasting impact.</strong>
            <em>More than a memory. A legacy.</em>
          </Link>
        </div>
      </section>

      <section className="band">
        <p className="kicker">How it works</p>
        <h2>You do every step.</h2>
        <p className="lede">There is no queue and no artist waiting on an email. The print is read, the words are set, and the order leaves on its own.</p>
        <div className="steps">
          {steps.map((step) => (
            <Link key={step.n} className="step" href="/how-it-works">
              <b>{step.n}</b>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="band">
        <p className="kicker">Occasions of honor</p>
        <h2>For every chapter that should be kept.</h2>
        <div className="cards">
          {occasions.map((occasion) => (
            <Link key={occasion.slug} className="card" href={`/occasions/${occasion.slug}`}>
              <h3>{occasion.title}</h3>
              <p>{occasion.lede}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="band">
        <p className="kicker">Gallery</p>
        <h2>Every piece is as particular as the hand.</h2>
        <div className="gallery-grid">
          {galleryPieces.map((piece) => (
            <Link key={piece.slug} href={`/gallery/${piece.slug}`} className="gallery-card">
              <img src={piece.image} alt={piece.title} />
              <figcaption>
                <strong>{piece.title}</strong>
                <p>{piece.caption}</p>
              </figcaption>
            </Link>
          ))}
        </div>
        <p><Link className="btn-ghost" href="/gallery">View the gallery</Link></p>
      </section>

      <section className="band">
        <p className="kicker">In a frame</p>
        <h2>Randy Czyz, held in the moulding.</h2>
        <p className="lede">The same portrait, in the black, white, and natural wood frames a framed print can ship in.</p>
        <FramedExamples src="/pieces/randy-czyz.png" title="Randy Czyz" />
        <p><Link className="btn-ghost" href="/studio?piece=randy-czyz&product=framed">See it in the studio</Link></p>
      </section>

      <section className="band">
        <p className="kicker">Example sentiments</p>
        <h2>The kind of thing families come to say.</h2>
        <p className="note">These are written for the prototype. They are not reviews from customers.</p>
        <div className="sentiment-grid">
          {sentiments.map((item) => (
            <blockquote className="sentiment" key={item.name}>
              <p>“{item.quote}”</p>
              <footer>{item.name}</footer>
            </blockquote>
          ))}
        </div>
        <p><Link className="btn-gold" href="/studio">Begin in the studio</Link></p>
      </section>
    </>
  );
}
