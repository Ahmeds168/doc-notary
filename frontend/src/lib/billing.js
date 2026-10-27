/**
 * Where "Get Standard" leads.
 *
 * Paid checkout isn't wired yet, so the button shows an early-access note. When Kelviq is
 * live, set STANDARD_CHECKOUT_URL to the Kelviq checkout link: that's the only change needed.
 */
export const STANDARD_CHECKOUT_URL = null;

export function standardPlanAction() {
  return STANDARD_CHECKOUT_URL ? { type: "checkout", href: STANDARD_CHECKOUT_URL } : { type: "early-access" };
}
