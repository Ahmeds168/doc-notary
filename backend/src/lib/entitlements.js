/**
 * Plans and entitlements.
 *
 * This module is the single source of plan limits for BOTH the abuse/cost protection
 * (quotas before uploads and relayer spend) and the paid tiers. Routes never read
 * profiles.plan directly — they ask getEntitlements().
 *
 * Kelviq billing (services/billing.js) keeps profiles.plan in sync with the user's Kelviq
 * subscription, so the default "local" provider is the one to use in production.
 */

const MB = 1024 * 1024;

export const PLAN_CATALOG = Object.freeze({
  free: Object.freeze({
    plan: "free",
    monthlyNotarizations: 3,
    maxFileSizeBytes: 5 * MB,
    historyDashboard: false,
    certificates: true, // PDF proof certificates — flip to false to make this Standard-only
    support: "none",
  }),
  standard: Object.freeze({
    plan: "standard",
    monthlyNotarizations: 25,
    maxFileSizeBytes: 25 * MB,
    historyDashboard: true,
    certificates: true,
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
