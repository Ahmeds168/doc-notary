import "./WakingBanner.css";

export function WakingBanner() {
  return (
    <div className="waking-banner">
      <span className="waking-banner__dot" aria-hidden="true" />
      <p>
        <strong>Waking up the server…</strong> This app sleeps when idle to
        save resources — it'll be ready in under a minute. Thanks for your
        patience.
      </p>
    </div>
  );
}