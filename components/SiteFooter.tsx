import Link from "next/link";
import { occasions } from "@/lib/content";
import { Logo } from "./Logo";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <Logo />
        <p>People leave fingerprints. Love leaves a legacy.</p>
      </div>
      <div>
        <h2>Visit</h2>
        <ul>
          <li><Link href="/how-it-works">How it works</Link></li>
          <li><Link href="/occasions">Occasions</Link></li>
          <li><Link href="/gallery">Gallery</Link></li>
          <li><Link href="/pricing">Pricing</Link></li>
          <li><Link href="/faq">Questions</Link></li>
          <li><Link href="/studio">Studio</Link></li>
        </ul>
      </div>
      <div>
        <h2>Occasions</h2>
        <ul>
          {occasions.map((occasion) => (
            <li key={occasion.slug}><Link href={`/occasions/${occasion.slug}`}>{occasion.title}</Link></li>
          ))}
          <li><Link href="/keepsakes/jewelry">Jewelry</Link></li>
          <li><Link href="/keepsakes/urns">Urns</Link></li>
          <li><Link href="/keepsakes/custom">Custom keepsakes</Link></li>
        </ul>
      </div>
      <div>
        <h2>The house</h2>
        <ul>
          <li><Link href="/privacy">Privacy</Link></li>
          <li><Link href="/terms">Terms</Link></li>
          <li><Link href="/dashboard">Owner dashboard</Link></li>
        </ul>
        <p className="legal">Orders go straight to the file or the press. No one retouches a portrait by hand.</p>
      </div>
    </footer>
  );
}
