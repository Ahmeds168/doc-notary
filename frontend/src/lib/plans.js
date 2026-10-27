/**
 * Plan limits as shown on the Pricing page.
 *
 * Mirrors PLAN_CATALOG in backend/src/lib/entitlements.js (the source of truth the backend
 * enforces). src/__tests__/plans.test.js fails if the two ever differ.
 */
const MB = 1024 * 1024;

export const PLANS = Object.freeze({
  free: Object.freeze({
    plan: "free",
    monthlyNotarizations: 3,
    maxFileSizeBytes: 5 * MB,
    historyDashboard: false,
    certificates: true,
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

export const STANDARD_PRICE = Object.freeze({ monthly: "US$5", yearly: "US$49" });

export const formatMb = (bytes) => `${Math.round(bytes / MB)} MB`;

/** Feature bullets for a plan card, derived from the limits above. */
export function planFeatures(plan) {
  const features = [
    `${plan.monthlyNotarizations} notarizations per month`,
    `Files up to ${formatMb(plan.maxFileSizeBytes)}`,
  ];
  if (plan.certificates) features.push("PDF proof certificates");
  if (plan.historyDashboard) features.push("Notarization history, with downloads of your originals");
  if (plan.support === "email") features.push("Email support");
  features.push("Unlimited verification");
  return features;
}
