import { pick } from "../lib/kelviq.js";
import { HttpError } from "../lib/errors.js";

/**
 * Billing: Kelviq checkout + plan sync.
 *
 * Kelviq is the source of truth for who has paid; profiles.plan is the local copy every
 * route reads (via entitlements). The Kelviq customer ID is the Supabase user ID, so a
 * checkout is always tied to the signed-in account.
 *
 * Sync runs: right after checkout (forced), on /api/me (throttled per user), and on any
 * verified Kelviq webhook for that customer (forced). Plans set by hand
 * (plan_source = 'manual', scripts/set-plan.js) are never overwritten.
 */

export const CHARGE_PERIODS = Object.freeze({ monthly: "MONTHLY", yearly: "YEARLY" });

// Status strings aren't documented, so match case-insensitively and log anything unknown.
const ACTIVE_STATUSES = new Set(["active", "trialing", "trial", "in_trial", "past_due", "unpaid_grace"]);
const ENDED_STATUSES = new Set(["refunded", "expired", "ended", "incomplete_expired", "void", "failed"]);

/** Does this subscription currently grant the Standard plan? */
export function subscriptionGrantsPlan(sub, planIdentifier, now = new Date()) {
  const plan = pick(sub, "plan");
  if ((pick(plan, "identifier") ?? "") !== planIdentifier) return false;
  const status = String(pick(sub, "status") ?? "").toLowerCase();
  if (ENDED_STATUSES.has(status)) return false;
  if (ACTIVE_STATUSES.has(status)) return true;
  // Cancelled (or unknown) but already paid up: keep access until the period ends.
  const endsAt = pick(sub, "billingPeriodEndTime") ?? pick(sub, "endDate");
  return Boolean(endsAt) && new Date(endsAt) > now;
}

export function createBilling({ config, store, kelviq, log, now = () => Date.now() }) {
  const { planIdentifier, syncIntervalMs } = config.billing;
  const enabled = Boolean(kelviq);
  const lastSync = new Map(); // userId -> ms

  function requireEnabled() {
    if (!enabled) throw new HttpError(503, "BILLING_UNAVAILABLE", "Paid plans aren't available right now.");
  }

  async function ensureCustomer(user) {
    try {
      await kelviq.getCustomer(user.id);
    } catch (err) {
      if (err.status !== 404) throw err;
      await kelviq.createCustomer({ customerId: user.id, email: user.email ?? undefined });
    }
  }

  /** Re-read the user's subscriptions from Kelviq and store the resulting plan. */
  async function syncPlan(userId, { force = false } = {}) {
    if (!enabled) return null;
    const last = lastSync.get(userId) ?? 0;
    if (!force && now() - last < syncIntervalMs) return null;
    lastSync.set(userId, now());

    const profile = await store.getProfile(userId);
    if (profile?.plan_source === "manual") return profile.plan;

    let subs;
    try {
      const data = await kelviq.listSubscriptions({ customerId: userId });
      subs = Array.isArray(data) ? data : (pick(data, "results") ?? []);
    } catch (err) {
      if (err.status === 404) subs = []; // no Kelviq customer yet = never paid
      else {
        lastSync.delete(userId); // retry on the next request
        throw err;
      }
    }

    for (const s of subs) {
      const status = String(pick(s, "status") ?? "").toLowerCase();
      if (status && !ACTIVE_STATUSES.has(status) && !ENDED_STATUSES.has(status)) {
        log.warn(`[billing] unrecognised Kelviq subscription status "${status}"; using its period end date`);
      }
    }

    const plan = subs.some((s) => subscriptionGrantsPlan(s, planIdentifier, new Date(now()))) ? "standard" : "free";
    const current = profile?.plan ?? "free";
    // Only write when Kelviq says something different, or when Kelviq now owns a paid plan.
    if (plan !== current || (plan === "standard" && profile?.plan_source !== "kelviq")) {
      await store.setUserPlan(userId, plan, "kelviq", userId);
      log.info(`[billing] plan for user changed: ${current} -> ${plan}`);
    }
    return plan;
  }

  /** Best-effort sync used by /api/me: never fails the request. */
  async function syncPlanQuietly(userId) {
    try {
      return await syncPlan(userId);
    } catch (err) {
      log.warn("[billing] plan sync failed; using the stored plan", err);
      return null;
    }
  }

  async function createCheckout(user, period) {
    requireEnabled();
    const chargePeriod = CHARGE_PERIODS[period];
    if (!chargePeriod) throw new HttpError(400, "INVALID_PERIOD", 'Choose "monthly" or "yearly".');

    const profile = await store.getProfile(user.id);
    if (profile?.plan === "standard") {
      throw new HttpError(409, "ALREADY_SUBSCRIBED", "You're already on the Standard plan.");
    }

    await ensureCustomer(user);
    const session = await kelviq.createCheckoutSession({
      planIdentifier,
      chargePeriod,
      customerId: user.id,
      successUrl: `${config.publicAppUrl}/?checkout=success`,
    });
    const url = pick(session, "checkoutUrl");
    if (!url) throw new Error("Kelviq didn't return a checkout URL.");
    return { url };
  }

  async function createPortal(user) {
    requireEnabled();
    const session = await kelviq.createPortalSession({ customerId: user.id });
    const url = pick(session, "customerPortalUrl");
    if (!url) throw new Error("Kelviq didn't return a customer portal URL.");
    return { url };
  }

  /** Handle a verified webhook event: re-sync whichever customer it's about. */
  async function handleWebhookEvent(event) {
    const customerId = findCustomerId(event);
    if (!customerId) {
      log.info(`[billing] webhook ${pick(event, "type") ?? "event"} has no customer id; ignored`);
      return { synced: false };
    }
    const profile = await store.getProfile(customerId).catch(() => null);
    if (!profile) {
      log.info("[billing] webhook for a customer that isn't a Doc Notary user; ignored");
      return { synced: false };
    }
    await syncPlan(customerId, { force: true });
    return { synced: true };
  }

  return { enabled, syncPlan, syncPlanQuietly, createCheckout, createPortal, handleWebhookEvent };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Find our customer id (a Supabase user UUID) anywhere sensible in a webhook payload. */
export function findCustomerId(event) {
  const candidates = [];
  const visit = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 4) return;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && /^customer_?id$/i.test(key)) candidates.push(value);
      else if (typeof value === "object") visit(value, depth + 1);
    }
  };
  visit(event, 0);
  return candidates.find((c) => UUID_RE.test(c)) ?? null;
}
