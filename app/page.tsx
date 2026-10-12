import Link from "next/link";
import { FORMATS, money } from "@/lib/catalog";

const occasions = [
  {
    title: "Memorials",
    body: "A quiet portrait for a service, a hallway, a family that wants more than two dates. The print they left, filled with the people and places that made the life.",
  },
  {
    title: "Retirement",
    body: "For officers, firefighters, nurses, teachers, and pastors. A career has a shape. This lets the years of service sit inside the lines they carried to work.",
  },
  {
    title: "Weddings & anniversaries",
    body: "Two prints, intertwined. Vows, a date, the names you hope to add later, the town where you began. Each ridge belongs to one of you, and they share the page.",
  },
  {
    title: "Founders",
    body: "A company started as a person. First office, first hires, the sentence they would not compromise. A piece for a lobby or a family office that still feels human.",
  },
];

export default function HomePage() {
  return (
    <main>
      <div className="wrap">
        <section className="hero">
          <div>
            <p className="eyebrow">An heirloom you make yourself</p>
            <h1>Their life, written into the lines they left.</h1>
            <p className="lede">
              Photograph a fingerprint. Add the names, places, dates, and verses that belong to that person. Every ridge
              of the finished piece is set in those words. You see it before you pay. Then it prints, or the file is yours.
            </p>
            <div className="hero-actions">
              <Link className="btn" href="/studio">
                Begin in the studio
              </Link>
              <Link className="btn secondary" href="/gallery">
                View the gallery
              </Link>
            </div>
          </div>
          <figure className="hero-frame">
            <img src="/gallery/memorial.jpg" alt="A fingerprint whose ridges are formed from a family's names and dates" />
            <figcaption>From across the room, a print. Up close, a life.</figcaption>
          </figure>
        </section>
      </div>

      <hr className="rule" />

      <section>
        <div className="wrap split">
          <div>
            <p className="eyebrow">More than a print</p>
            <h2>The story is the ink.</h2>
          </div>
          <div>
            <p className="lede">
              A fingerprint is already a portrait no one else can wear. We keep its ridges and let your words become the
              line: children and grandchildren, towns they called home, a verse they knew by heart, the years they served.
              Nothing is redrawn by a stranger. The piece on your screen is the piece that ships.
            </p>
            <div className="feature-list">
              <article>
                <h3>Their print, kept</h3>
                <p>Ridges are traced from the photograph you supply, not borrowed from a generic swirl.</p>
              </article>
              <article>
                <h3>Words you choose</h3>
                <p>Names, dates, places, a line from a vow or a prayer. As many as you need, in the order you want them read.</p>
              </article>
              <article>
                <h3>An object that lasts</h3>
                <p>A file you hold, a matte archival print, or a framed piece that arrives ready to hang.</p>
              </article>
            </div>
          </div>
        </div>
      </section>

      <section id="how">
        <div className="wrap">
          <p className="eyebrow">How it works</p>
          <h2>Four steps. No one else has to touch it.</h2>
          <div className="steps">
            <article className="step">
              <b>01</b>
              <h3>Photograph the print</h3>
              <p>A clear photo or a scan of an inked print. A phone camera is enough. You can take it in the studio.</p>
            </article>
            <article className="step">
              <b>02</b>
              <h3>Gather the words</h3>
              <p>Enter the names, places, dates, and lines that should form the ridges. For two people, add a second print.</p>
            </article>
            <article className="step">
              <b>03</b>
              <h3>Compose the piece</h3>
              <p>Choose the type, the ink, the paper color, and the size. The preview updates as you write.</p>
            </article>
            <article className="step">
              <b>04</b>
              <h3>It makes itself</h3>
              <p>Pay, and a digital file is ready at once — or a print is sent to press and shipped to the door.</p>
            </article>
          </div>
        </div>
      </section>

      <section id="occasions">
        <div className="wrap">
          <p className="eyebrow">Occasions</p>
          <h2>For the chapters worth keeping.</h2>
          <div className="cards">
            {occasions.map((item) => (
              <article className="card" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <p className="eyebrow">Gallery</p>
          <h2>Every print keeps its own hand.</h2>
          <div className="gallery-grid">
            <figure>
              <img src="/gallery/memorial.jpg" alt="Memorial fingerprint in ivory and ink" />
              <figcaption>Memorial · Ivory & ink</figcaption>
            </figure>
            <div className="stack">
              <figure>
                <img src="/gallery/retirement.jpg" alt="Retirement fingerprint in navy and cream" />
                <figcaption>Retirement · Navy & cream</figcaption>
              </figure>
              <figure>
                <img src="/gallery/wedding.jpg" alt="Two intertwined fingerprints for a wedding" />
                <figcaption>Wedding · Two prints</figcaption>
              </figure>
            </div>
          </div>
          <p style={{ marginTop: 18 }}>
            <Link href="/gallery">View the full gallery</Link>
          </p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <p className="eyebrow">Formats & pricing</p>
          <h2>Choose how it should live.</h2>
          <div className="prices">
            {(Object.keys(FORMATS) as Array<keyof typeof FORMATS>).map((id) => {
              const format = FORMATS[id];
              const from = Math.min(...Object.values(format.prices));
              return (
                <article className="price" key={id}>
                  <p className="eyebrow">{format.ships ? "Ships to you" : "Instant"}</p>
                  <h3>{format.name}</h3>
                  <strong>{money(from)}</strong>
                  <p>{format.summary}</p>
                  <Link className="btn" href="/studio">
                    Design this
                  </Link>
                </article>
              );
            })}
          </div>
          <p style={{ marginTop: 18 }}>
            <Link href="/pricing">See sizes and what is included</Link>
          </p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <p className="eyebrow">In their words</p>
          <h2>What people come hoping to hold.</h2>
          <div className="quotes">
            <blockquote>
              <p>“I wanted her grandchildren’s names somewhere a stranger would have to step closer to read.”</p>
              <footer>A daughter, about a memorial print</footer>
            </blockquote>
            <blockquote>
              <p>“Twenty-six years on the job, and the only portrait that felt right was the one he already had on his hands.”</p>
              <footer>A fire captain’s family, on retirement</footer>
            </blockquote>
            <blockquote>
              <p>“Our vows don’t hang on the wall as calligraphy. They are the fingerprint. Both of them.”</p>
              <footer>A couple, on an anniversary piece</footer>
            </blockquote>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="cta-band">
            <div>
              <p className="eyebrow" style={{ color: "#c6a07a" }}>
                Begin
              </p>
              <h2>The preview is the print.</h2>
              <p>No proofs by email. No artist in the middle. You compose the piece, and the order goes to press.</p>
            </div>
            <Link className="btn" href="/studio">
              Open the studio
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
