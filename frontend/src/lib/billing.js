import { startCheckout, openBillingPortal } from "./api.js";

export const PERIODS = Object.freeze(["monthly", "yearly"]);

/**
 * "Upgrade" intent carried through sign-in: the Pricing page sends signed-out visitors to
 * /?signup=1&upgrade=<period>; once they're signed in, the home page continues to checkout.
 */
const INTENT_KEY = "docNotary.upgradeIntent";
const INTENT_TTL_MS = 60 * 60 * 1000;

export function readUpgradeIntent(search = window.location.search, storage = safeStorage(), now = Date.now()) {
  const period = new URLSearchParams(search).get("upgrade");
  if (PERIODS.includes(period)) {
    // Kept briefly so it survives the sign-up email confirmation, which opens a new page.
    try {
      storage?.setItem(INTENT_KEY, JSON.stringify({ period, at: now }));
    } catch {
      /* storage unavailable: the URL parameter still works for existing accounts */
    }
    return period;
  }
  try {
    const saved = JSON.parse(storage?.getItem(INTENT_KEY) ?? "null");
    if (saved && PERIODS.includes(saved.period) && now - saved.at < INTENT_TTL_MS) return saved.period;
  } catch {
    /* ignore */
  }
  return null;
}

export function clearUpgradeIntent(storage = safeStorage()) {
  try {
    storage?.removeItem(INTENT_KEY);
  } catch {
    /* ignore */
  }
}

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readCheckoutReturn(search = window.location.search) {
  return new URLSearchParams(search).get("checkout") === "success";
}

/** Remove our one-shot query parameters so a reload doesn't repeat them. */
export function clearBillingParams() {
  const url = new URL(window.location.href);
  ["upgrade", "checkout", "signup"].forEach((k) => url.searchParams.delete(k));
  clearUpgradeIntent();
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function signupForUpgradeHref(period) {
  return `/?signup=1&upgrade=${period}`;
}

/** Create a Kelviq checkout for this user and go there. Resolves only on failure. */
export async function goToCheckout(period, token, navigate = (url) => window.location.assign(url)) {
  const { url } = await startCheckout(period, token);
  navigate(url);
}

export async function goToBillingPortal(token, navigate = (url) => window.location.assign(url)) {
  const { url } = await openBillingPortal(token);
  navigate(url);
}

/** Friendly text for a failed checkout/portal call. */
export function billingErrorMessage(err) {
  if (err?.code === "ALREADY_SUBSCRIBED") return "You're already on the Standard plan.";
  if (err?.code === "BILLING_UNAVAILABLE") return "Paid plans are temporarily unavailable. Please try again later.";
  if (err?.status === 401) return "Your session has expired. Sign in again to continue.";
  if (err?.status === 429) return "Too many attempts. Please wait a minute and try again.";
  return "Couldn't open checkout right now. Please try again in a minute.";
}
