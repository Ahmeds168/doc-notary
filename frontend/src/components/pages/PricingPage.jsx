import { useEffect, useState } from "react";
import { PLANS, STANDARD_PRICE, planFeatures } from "../../lib/plans.js";
import { goToCheckout, goToBillingPortal, signupForUpgradeHref, billingErrorMessage, trackFunnel } from "../../lib/billing.js";
import { getMe } from "../../lib/api.js";
import { useSession } from "../../lib/useSession.js";
import { BetaNotice } from "./BetaNotice.jsx";
import "./Page.css";

/**
 * Standard CTA. Signed out: sign up first, then continue to checkout (upgrade intent in the URL).
 * Signed in: straight to Kelviq checkout. Already on Standard: manage the subscription instead.
 */
function StandardButton() {
  const { session } = useSession();
  const token = session?.access_token ?? null;
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    getMe(token)
      .then((me) => active && setPlan(me.plan))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [token]);

  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(billingErrorMessage(err));
      setBusy(false);
    }
  }

  if (token && plan === "standard") {
    return (
      <>
        <p className="plan-card__note">You're on the Standard plan.</p>
        <button type="button" className="plan-card__cta" disabled={busy} onClick={() => run(() => goToBillingPortal(token))}>
          {busy ? "Opening…" : "Manage subscription"}
        </button>
        {error && <p className="plan-card__note" role="alert">{error}</p>}
      </>
    );
  }

  if (!token) {
    return (
      <>
        <a className="plan-card__cta" href={signupForUpgradeHref("monthly")} onClick={() => trackFunnel("pricing_cta", { period: "monthly", signed_in: "no" })}>
          Get Standard monthly
        </a>
        <a className="plan-card__alt" href={signupForUpgradeHref("yearly")} onClick={() => trackFunnel("pricing_cta", { period: "yearly", signed_in: "no" })}>
          or pay {STANDARD_PRICE.yearly} yearly
        </a>
      </>
    );
  }

  return (
    <>
      <button type="button" className="plan-card__cta" disabled={busy} onClick={() => {
          trackFunnel("pricing_cta", { period: "monthly", signed_in: "yes" });
          run(() => goToCheckout("monthly", token));
        }}>
        {busy ? "Opening checkout…" : "Get Standard monthly"}
      </button>
      <button type="button" className="plan-card__alt" disabled={busy} onClick={() => {
          trackFunnel("pricing_cta", { period: "yearly", signed_in: "yes" });
          run(() => goToCheckout("yearly", token));
        }}>
        or pay {STANDARD_PRICE.yearly} yearly
      </button>
      {error && <p className="plan-card__note" role="alert">{error}</p>}
    </>
  );
}

export function PricingPage() {
  const { free, standard } = PLANS;
  return (
    <main className="page">
      <p className="page__eyebrow">Pricing</p>
      <h1>Simple plans for proving when a file existed</h1>
      <p>
        <strong>Verification is free and unlimited on both plans, and needs no account.</strong> Anyone can check a
        file or hash at any time; plans only limit how many new documents you notarize.
      </p>

      <BetaNotice />

      <div className="pricing__grid">
        <section className="plan-card" aria-labelledby="plan-free">
          <h2 id="plan-free">Free</h2>
          <p className="plan-card__price">US$0</p>
          <ul>
            {planFeatures(free).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <a className="plan-card__cta plan-card__cta--secondary" href="/?signup=1">
            Start free
          </a>
        </section>

        <section className="plan-card plan-card--featured" aria-labelledby="plan-standard">
          <h2 id="plan-standard">Standard</h2>
          <p className="plan-card__price">
            {STANDARD_PRICE.monthly} <small>/ month</small> <small>or</small> {STANDARD_PRICE.yearly}{" "}
            <small>/ year</small>
          </p>
          <ul>
            {planFeatures(standard).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <StandardButton />
        </section>
      </div>

      <p className="pricing__tax">
        Prices are in US dollars. Any sales tax or VAT that applies where you live is added at checkout. Payments are
        handled by Kelviq, our merchant of record; you can cancel any time.
      </p>

      <p>
        Monthly limits reset at the start of each calendar month (UTC). Failed notarization attempts don't count
        toward your limit. See the <a href="/terms">Terms of Service</a> and <a href="/refund-policy">Refund Policy</a>{" "}
        for details.
      </p>
    </main>
  );
}
