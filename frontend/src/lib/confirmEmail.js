/**
 * Email confirmation links point at our own site instead of the Supabase project URL
 * (better for spam filtering, and the link matches the site the user signed up on).
 *
 * Supabase "Confirm signup" template link:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
 */
export const CONFIRM_PATH = "/auth/confirm";
const ALLOWED_TYPES = new Set(["email"]);

/** Returns { tokenHash, type } when the current URL is a confirmation link, else null. */
export function readConfirmationParams(location) {
  if (location.pathname.replace(/\/+$/, "") !== CONFIRM_PATH) return null;
  const params = new URLSearchParams(location.search);
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (!tokenHash || !ALLOWED_TYPES.has(type)) return { invalid: true };
  return { tokenHash, type };
}

let inFlight = null;

/**
 * Verify the token once (guards against React StrictMode running effects twice — a token
 * can only be used once), then strip it from the address bar.
 * Resolves to "confirmed" | "invalid" | "failed" | null (not a confirmation link).
 */
export function confirmEmailFromUrl(client, { location = window.location, history = window.history } = {}) {
  const parsed = readConfirmationParams(location);
  if (!parsed) return Promise.resolve(null);
  if (!inFlight) {
    inFlight = (async () => {
      history.replaceState(null, "", "/");
      if (parsed.invalid || !client) return "invalid";
      const { error } = await client.auth.verifyOtp({ token_hash: parsed.tokenHash, type: parsed.type });
      return error ? "failed" : "confirmed";
    })();
  }
  return inFlight;
}

/** Test helper. */
export function _resetConfirmationState() {
  inFlight = null;
}
