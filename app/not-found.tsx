import Link from "next/link";

export default function NotFound() {
  return (
    <article className="page">
      <h1>That page is not here.</h1>
      <p className="lede">The portrait you wanted may be in the studio.</p>
      <p>
        <Link className="btn-gold" href="/">Go home</Link>{" "}
        <Link className="btn-ghost" href="/studio">Open the studio</Link>
      </p>
    </article>
  );
}
