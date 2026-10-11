/**
 * Plans and entitlements.
 *
 * This module is the single source of plan limits for BOTH the abuse/cost protection
 * (quotas before uploads and relayer spend) and the paid tiers. Routes never read
 * profiles.plan directly — they ask getEntitlements().
 *
 * Plan sources:
 *  - "local"  (default, BILLING_ENABLED=false): profiles.plan, set by scripts/set-plan.js.
 *  - "kelviq" (BILLING_ENABLED=true): Kelviq decides which plan a user is on. Standard =
 *    the customer (customerId = Supabase user id) has access to KELVIQ_STANDARD_FEATURE_ID.
 *    Results are cached briefly per instance and written through to profiles.plan
 *    (plan_source = 'kelviq'); webhooks refresh them immediately. If Kelviq is unreachable
 *    we fall back to the last synced profiles.plan. A plan set manually by an operator
 *    (plan_source = 'manual') is an override and is never replaced by Kelviq.
 *
 * Usage counting stays in Postgres (reserve_notarization) either way. Nothing is reported
 * to Kelviq meters.
 */

const MB = 1024 * 1024;

export const PLAN_CATALOG = Object.freeze({
  free: Object.freeze({
    plan: "free",
    monthlyNotarizations: 3,
    maxFileSizeBytes: 5 * MB,
    historyDashboard: false,
    support: "none",
  }),
  standard: Object.freeze({
    plan: "standard",
    monthlyNotarizations: 25,
    maxFileSizeBytes: 25 * MB,
    historyDashboard: true,
    support: "email",
  }),
});

export const DEFAULT_PLAN = "free";

export function entitlementsForPlan(plan, { globalMaxFileSizeBytes = Infinity } = {}) {
  const base = PLAN_CATALOG[plan] ?? PLAN_CATALOG[DEFAULT_PLAN];
  // MAX_FILE_SIZE_BYTES is an operator ceiling that can only lower a plan's limit.
  return { ...base, maxFileSizeBytes: Math.min(base.maxFileSizeBytes, globalMaxFileSizeBytes) };
}

/** Default provider: reads the plan synced into profiles.plan. Missing profile => free. */
export function createLocalEntitlementProvider(store) {
  return {
    async getPlan(userId) {
      const profile = await store.getProfile(userId);
      return profile?.plan && PLAN_CATALOG[profile.plan] ? profile.plan : DEFAULT_PLAN;
    },
  };
}

/** Kelviq entitlements → PLAN_CATALOG key. */
export function planFromKelviqEntitlements(entitlements, standardFeatureId) {
  return entitlements.some((e) => e.featureId === standardFeatureId && e.hasAccess) ? "standard" : DEFAULT_PLAN;
}

/**
 * Kelviq-backed provider. getPlan() never fails because of Kelviq: on an outage it serves
 * the last synced profiles.plan. refresh() bypasses the cache and DOES throw on Kelviq
 * errors, so the webhook can answer 5xx and let Kelviq retry.
 */
export function createKelviqEntitlementProvider({ store, kelviq, standardFeatureId, cacheTtlMs = 60_000, log, now = Date.now }) {
  if (!kelviq || !standardFeatureId) throw new Error("Kelviq entitlement provider needs a Kelviq client and KELVIQ_STANDARD_FEATURE_ID");
  const cache = new Map(); // userId -> { plan, expiresAt }

  const storedPlan = (profile) => (profile?.plan && PLAN_CATALOG[profile.plan] ? profile.plan : DEFAULT_PLAN);

  async function sync(userId, profile) {
    const plan = planFromKelviqEntitlements(await kelviq.getEntitlements(userId), standardFeatureId);
    cache.set(userId, { plan, expiresAt: now() + cacheTtlMs });
    if (profile && profile.plan !== plan) {
      try {
        await store.setUserPlan(userId, plan, "kelviq", userId);
      } catch (err) {
        log?.warn("[billing] could not persist synced plan", err);
      }
    }
    return plan;
  }

  return {
    async getPlan(userId) {
      const profile = await store.getProfile(userId);
      if (profile?.plan_source === "manual") return storedPlan(profile);

      const hit = cache.get(userId);
      if (hit && hit.expiresAt > now()) return hit.plan;
      try {
        return await sync(userId, profile);
      } catch (err) {
        log?.warn("[billing] Kelviq entitlements unavailable, using last synced plan", err);
        return storedPlan(profile);
      }
    },

    /**
     * Re-read the plan from Kelviq and persist it. Returns { plan, changed } or
     * { skipped } for unknown users and manual overrides.
     */
    async refresh(userId) {
      cache.delete(userId);
      const profile = await store.getProfile(userId);
      if (!profile) return { skipped: "unknown_user" };
      if (profile.plan_source === "manual") return { skipped: "manual_override", plan: storedPlan(profile) };
      const plan = await sync(userId, profile);
      return { plan, changed: plan !== storedPlan(profile) };
    },
  };
}

export function createEntitlements({ store, config, provider, kelviq, log }) {
  const planProvider =
    provider ??
    (config.entitlements.provider === "kelviq"
      ? createKelviqEntitlementProvider({
          store,
          kelviq,
          standardFeatureId: config.billing.kelviq.standardFeatureId,
          cacheTtlMs: config.billing.kelviq.cacheTtlMs,
          log,
        })
      : createLocalEntitlementProvider(store));

  return {
    async getEntitlements(userId) {
      const plan = await planProvider.getPlan(userId);
      return entitlementsForPlan(plan, { globalMaxFileSizeBytes: config.upload.maxFileSizeBytes });
    },

    /** Only the Kelviq provider supports this (used by the billing webhook). */
    async refreshPlan(userId) {
      if (!planProvider.refresh) throw new Error("The active entitlements provider cannot refresh plans");
      return planProvider.refresh(userId);
    },
  };
}
