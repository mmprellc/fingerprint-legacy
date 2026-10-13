"use client";

import Link from "next/link";
import { useState } from "react";
import { Logo } from "./Logo";

const links = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/occasions", label: "Occasions" },
  { href: "/gallery", label: "Gallery" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <Logo withTagline />
      <button className="nav-toggle" type="button" aria-expanded={open} aria-label="Menu" onClick={() => setOpen((value) => !value)}>
        <span />
        <span />
        <span />
      </button>
      <nav className={open ? "nav open" : "nav"}>
        {links.map((link) => (
          <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>
            {link.label}
          </Link>
        ))}
        <Link className="nav-cta" href="/studio" onClick={() => setOpen(false)}>
          Begin in the studio
        </Link>
      </nav>
    </header>
  );
}
