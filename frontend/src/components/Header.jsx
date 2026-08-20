import "./Header.css";

export function Header() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <div className="site-header__brand">
          <svg viewBox="0 0 40 40" className="site-header__mark" aria-hidden="true">
            <circle cx="20" cy="20" r="18" fill="none" stroke="var(--brass-500)" strokeWidth="2" />
            <circle cx="20" cy="20" r="6" fill="var(--brass-500)" />
          </svg>
          <span className="site-header__title">Document Notary</span>
        </div>
        <span className="site-header__badge mono">Sepolia Testnet</span>
      </div>
    </header>
  );
}
