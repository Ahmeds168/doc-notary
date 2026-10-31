import { BUSINESS, FOOTER_LINKS } from "../lib/site.js";
import "./Footer.css";

export function Footer() {
  return (
    <footer className="site-footer">
      <nav className="site-footer__nav" aria-label="Site">
        {FOOTER_LINKS.map((link, i) => (
          <span key={link.href}>
            {i > 0 && <span className="site-footer__sep" aria-hidden="true">·</span>}
            <a href={link.href}>{link.label}</a>
          </span>
        ))}
      </nav>
      <p className="site-footer__legal">
        © 2026 {BUSINESS.tradingName} · {BUSINESS.country} ·{" "}
        <span className="site-footer__email">{BUSINESS.email}</span>
      </p>
    </footer>
  );
}
