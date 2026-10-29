import { BUSINESS } from "../lib/site.js";
import "./WakingBanner.css";

const MESSAGES = {
  redirecting: { title: "Opening secure checkout…", body: "You'll pay on Kelviq, our payment provider." },
  checking: { title: "Confirming your payment…", body: "This takes a few seconds." },
  upgraded: { title: "You're on Standard.", body: "Thanks for subscribing. Your new limits apply right away." },
  pending: {
    title: "Payment received, still confirming.",
    body: `Your plan should update within a few minutes. Reload this page shortly, or email ${BUSINESS.email} if it doesn't.`,
  },
  error: { title: "Checkout didn't open.", body: "" },
};

export function CheckoutBanner({ state, error, onDismiss }) {
  const msg = MESSAGES[state];
  if (!msg) return null;
  const busy = state === "redirecting" || state === "checking";
  return (
    <div className="waking-banner" role="status">
      <p>
        <strong>{msg.title}</strong> {state === "error" ? error : msg.body}
      </p>
      {!busy && (
        <button type="button" className="confirm-banner__close" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}
