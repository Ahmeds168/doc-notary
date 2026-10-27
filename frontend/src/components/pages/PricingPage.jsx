import { useState } from "react";
import { PLANS, STANDARD_PRICE, planFeatures } from "../../lib/plans.js";
import { standardPlanAction } from "../../lib/billing.js";
import { BUSINESS } from "../../lib/site.js";
import { BetaNotice } from "./BetaNotice.jsx";
import "./Page.css";

function StandardButton() {
  const [showNote, setShowNote] = useState(false);
  const action = standardPlanAction();
  if (action.type === "checkout") {
    return (
      <a className="plan-card__cta" href={action.href}>
        Get Standard
      </a>
    );
  }
  return (
    <>
      <button type="button" className="plan-card__cta" onClick={() => setShowNote(true)} aria-expanded={showNote}>
        Get Standard
      </button>
      {showNote && (
        <p className="plan-card__note" role="status">
          Paid plans launch shortly — email {BUSINESS.email} to get early access.
        </p>
      )}
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

      <p>
        Monthly limits reset at the start of each calendar month (UTC). Failed notarization attempts don't count
        toward your limit. See the <a href="/terms">Terms of Service</a> and <a href="/refund-policy">Refund Policy</a>{" "}
        for details.
      </p>
    </main>
  );
}
