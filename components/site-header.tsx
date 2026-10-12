import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="wrap">
        <nav>
          <Link href="/" className="wordmark">
            Fingerprint Legacy
            <small>Also known as The Dash</small>
          </Link>
          <input id="nav-toggle" className="nav-toggle" type="checkbox" aria-label="Open menu" />
          <label className="menu-button" htmlFor="nav-toggle">
            Menu
          </label>
          <div className="nav-links">
            <a href="/#occasions">Occasions</a>
            <Link href="/gallery">Gallery</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/studio" className="btn">
              Open the studio
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
