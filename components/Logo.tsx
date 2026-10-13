import Link from "next/link";

export function FingerprintMark() {
  return (
    <svg className="logo-mark" width="52" height="52" viewBox="0 0 64 64" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M32 52c-9 0-15-7-15-17C17 22 23 13 32 13s15 9 15 22c0 6-2 11-5 14" />
        <path d="M32 46c-6 0-10-5-10-12 0-9 4.5-15 10-15s10 6 10 15c0 4-1 7-3 9" />
        <path d="M32 40c-3.2 0-5.5-2.6-5.5-7S28.8 26 32 26s5.5 3 5.5 7-1 4.2-2 5.2" />
        <path d="M22 48c-7-5-9-12-9-18C13 16 21 7 32 7s19 9 19 23c0 9-4 17-9 22" />
      </g>
    </svg>
  );
}

export function Logo({ withTagline = false }: { withTagline?: boolean }) {
  return (
    <div>
      <Link href="/" className="logo" aria-label="Fingerprint Legacy, home">
        <span>
          <span className="logo-word">Fingerprint</span>
          <span className="logo-sub">Legacy</span>
        </span>
        <FingerprintMark />
      </Link>
      {withTagline ? <p className="tagline">People leave fingerprints. Love leaves a legacy.</p> : null}
    </div>
  );
}
