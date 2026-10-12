import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div>
          <strong>Fingerprint Legacy</strong>
          <div>A self-serve studio for prints made of words. Also known as The Dash.</div>
        </div>
        <div>
          <Link href="/studio">Studio</Link>
          {" · "}
          <Link href="/gallery">Gallery</Link>
          {" · "}
          <Link href="/pricing">Pricing</Link>
          {" · "}
          <Link href="/dashboard">Orders</Link>
        </div>
      </div>
    </footer>
  );
}
