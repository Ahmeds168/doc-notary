import { useState } from "react";
import { supabase } from "../lib/supabase.js";
import { goToBillingPortal } from "../lib/billing.js";
import "./Header.css";

export function Header({ session, plan }) {
  const [opening, setOpening] = useState(false);
  const manage = () => {
    setOpening(true);
    goToBillingPortal(session.access_token).catch(() => {
      setOpening(false);
      window.location.assign("/pricing");
    });
  };
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <a className="site-header__brand" href="/" aria-label="Doc Notary home">
          <svg viewBox="0 0 40 40" className="site-header__mark" aria-hidden="true">
            <circle cx="20" cy="20" r="18" fill="none" stroke="var(--brass-500)" strokeWidth="2" />
            <circle cx="20" cy="20" r="6" fill="var(--brass-500)" />
          </svg>
          <span className="site-header__title">Document Notary</span>
        </a>
        <div className="site-header__right">
          {session && (
            <div className="site-header__account">
              <span className="site-header__email" title={session.user.email}>
                {session.user.email}
              </span>
              {plan && <span className="site-header__plan mono">{plan}</span>}
              {plan === "standard" ? (
                <button type="button" className="site-header__signout" onClick={manage} disabled={opening}>
                  {opening ? "Opening…" : "Billing"}
                </button>
              ) : (
                plan && (
                  <a className="site-header__signout site-header__upgrade" href="/pricing">
                    Upgrade
                  </a>
                )
              )}
              <button type="button" className="site-header__signout" onClick={() => supabase?.auth.signOut()}>
                Sign out
              </button>
            </div>
          )}
          <span className="site-header__badge mono">Sepolia Testnet</span>
        </div>
      </div>
    </header>
  );
}
