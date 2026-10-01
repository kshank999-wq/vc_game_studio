import Link from 'next/link';

/** The mark: a gold diamond over a spine line, the studio's story track in a glyph. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="15" width="30" height="2" fill="#8a6f2f" />
      <path d="M16 3 L27 16 L16 29 L5 16 Z" fill="none" stroke="#c9a45c" strokeWidth="2" />
      <path d="M16 10 L21 16 L16 22 L11 16 Z" fill="#e8c872" />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="wrap">
        <Link href="/" className="wordmark" aria-label="VC Game Studio home">
          <Mark />
          <span>
            VC <b>Game Studio</b>
          </span>
        </Link>
        <nav className="site-nav" aria-label="Site">
          <Link href="/#features">Features</Link>
          <Link href="/pricing">Pricing</Link>
          <a href="/preview">Try it online</a>
          <Link href="/download">Download</Link>
          <Link href="/account">Account</Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <span>© {new Date().getFullYear()} VC Game Studio · a VC product, with VC Writer</span>
        <span>
          <a href="https://vc-writer.com">VC Writer</a> · <Link href="/pricing">Pricing</Link> · <Link href="/account">Account</Link>
        </span>
      </div>
    </footer>
  );
}
