/**
 * Plans and entitlements.
 *
 * This module is the single source of plan limits for BOTH the abuse/cost protection
 * (quotas before uploads and relayer spend) and the paid tiers. Routes never read
 * profiles.plan directly — they ask getEntitlements().
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ KELVIQ INTEGRATION POINT                                                    │
 * │                                                                             │
 * │ Kelviq (merchant of record) is not integrated yet. To wire it up:           │
 * │  1. Implement createKelviqEntitlementProvider() below: call Kelviq's        │
 * │     entitlement / usage-check API for the user and map the result to a      │
 * │     PLAN_CATALOG key ("free" | "standard"). Cache briefly; on Kelviq        │
 * │     outage, fall back to the last synced profiles.plan.                     │
 * │  2. Add a signature-verified Kelviq webhook route that calls                │
 * │     store.setUserPlan(userId, plan, "kelviq", kelviqCustomerId) so          │
 * │     profiles.plan stays in sync (plan_source = 'kelviq').                   │
 * │  3. Set ENTITLEMENTS_PROVIDER=kelviq.                                       │
 * │ Usage counting stays in Postgres (reserve_notarization) either way; if      │
 * │ Kelviq should also meter usage, report it after an operation is confirmed.  │
 * └─────────────────────────────────────────────────────────────────────────────┘
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

/** KELVIQ INTEGRATION POINT — see the header comment. */
export function createKelviqEntitlementProvider() {
  return {
    async getPlan() {
      throw new Error("Kelviq entitlement provider is not implemented yet (ENTITLEMENTS_PROVIDER=kelviq).");
    },
  };
}

export function createEntitlements({ store, config, provider }) {
  const planProvider =
    provider ??
    (config.entitlements.provider === "kelviq"
      ? createKelviqEntitlementProvider()
      : createLocalEntitlementProvider(store));

  return {
    async getEntitlements(userId) {
      const plan = await planProvider.getPlan(userId);
      return entitlementsForPlan(plan, { globalMaxFileSizeBytes: config.upload.maxFileSizeBytes });
    },
  };
}
