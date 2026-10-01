import "./WakingBanner.css";

const MESSAGES = {
  confirmed: { title: "Email confirmed.", body: "You're signed in and ready to notarize." },
  failed: {
    title: "That confirmation link didn't work.",
    body: "It may have expired or already been used. Try signing in, or create the account again to get a new link.",
  },
  invalid: { title: "That confirmation link is incomplete.", body: "Open the link from your email again, or request a new one." },
};

export function ConfirmBanner({ result, onDismiss }) {
  const msg = MESSAGES[result];
  if (!msg) return null;
  return (
    <div className="waking-banner" role="status">
      <p>
        <strong>{msg.title}</strong> {msg.body}
      </p>
      <button type="button" className="confirm-banner__close" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
