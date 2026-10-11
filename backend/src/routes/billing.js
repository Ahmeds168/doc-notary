import express, { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { rateLimit } from "../lib/rateLimit.js";
import { HttpError } from "../lib/errors.js";
import { CHARGE_PERIODS, KelviqError, WebhookVerificationError, customerIdFromEvent, verifyKelviqWebhook } from "../lib/kelviq.js";

/**
 * Kelviq billing. Mounted only when BILLING_ENABLED=true, and BEFORE the global JSON parser:
 * the webhook needs the exact raw bytes to check the signature.
 *
 *   POST /api/billing/checkout        (auth) { interval: "monthly" | "yearly" } → { checkoutUrl }
 *   POST /api/billing/webhooks/kelviq (Kelviq → us, signature-verified)
 */
export function createBillingRouter({ config, auth, entitlements, kelviq, log }) {
  const router = Router();
  const billing = config.billing;

  const requireConfigured = (_req, _res, next) =>
    next(billing.configured ? undefined : new HttpError(503, "BILLING_UNAVAILABLE", "Billing is not available right now."));

  const checkoutLimiter = rateLimit({ limit: 5, keyFn: (req) => `checkout:${req.user.id}` });

  router.post(
    "/checkout",
    requireConfigured,
    express.json({ limit: "4kb" }),
    requireAuth(auth, log),
    checkoutLimiter,
    async (req, res, next) => {
      try {
        const chargePeriod = CHARGE_PERIODS[req.body?.interval ?? "monthly"];
        if (!chargePeriod) throw new HttpError(400, "INVALID_INTERVAL", 'interval must be "monthly" or "yearly".');

        const current = await entitlements.getEntitlements(req.user.id).catch((err) => {
          log.error("[billing] entitlements lookup failed", err);
          throw new HttpError(503, "ENTITLEMENTS_UNAVAILABLE", "Couldn't load your plan. Please try again shortly.");
        });
        if (current.plan === "standard") {
          throw new HttpError(409, "ALREADY_SUBSCRIBED", "You're already on the Standard plan.");
        }

        // Hosted checkout needs an email on the customer. A 4xx here usually means the
        // customer already exists; checkout itself is the real test.
        if (req.user.email) {
          await kelviq.createCustomer({ customerId: req.user.id, email: req.user.email }).catch((err) => {
            if (!(err instanceof KelviqError && err.status >= 400 && err.status < 500)) throw err;
          });
        }

        const session = await kelviq.createCheckoutSession({
          customerId: req.user.id,
          planIdentifier: billing.kelviq.standardPlanId,
          chargePeriod,
          successUrl: `${billing.frontendUrl}/?checkout=success`,
          cancelUrl: `${billing.frontendUrl}/?checkout=cancelled`,
          metadata: { userId: req.user.id },
        });
        res.json(session);
      } catch (err) {
        if (err instanceof HttpError) return next(err);
        log.error("[billing] checkout failed", err);
        next(new HttpError(502, "CHECKOUT_FAILED", "Couldn't start checkout. Please try again shortly."));
      }
    }
  );

  /**
   * Kelviq webhook. We don't trust the event's contents for the plan: a verified event
   * only tells us WHICH customer changed, and we re-read that customer's entitlements
   * from Kelviq. That makes delivery order, retries and duplicates harmless.
   * 2xx = handled or deliberately ignored; 5xx = Kelviq should retry.
   */
  router.post(
    "/webhooks/kelviq",
    requireConfigured,
    express.raw({ type: () => true, limit: "256kb" }),
    async (req, res, next) => {
      let event;
      try {
        event = verifyKelviqWebhook({
          rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          headers: req.headers,
          secret: billing.kelviq.webhookSecret,
          toleranceSeconds: billing.kelviq.webhookToleranceSeconds,
        });
      } catch (err) {
        if (err instanceof WebhookVerificationError) {
          log.warn(`[billing] rejected webhook: ${err.message}`);
          return next(new HttpError(400, "INVALID_SIGNATURE", "Invalid webhook signature."));
        }
        return next(err);
      }

      const type = typeof event?.type === "string" ? event.type.slice(0, 64) : "unknown";
      const userId = customerIdFromEvent(event);
      if (!userId) {
        log.info(`[billing] webhook ${type}: no customer id, ignored`);
        return res.json({ received: true, ignored: "no_customer" });
      }

      try {
        const result = await entitlements.refreshPlan(userId);
        log.info(`[billing] webhook ${type}: ${result.skipped ? `skipped (${result.skipped})` : `plan=${result.plan}${result.changed ? " (changed)" : ""}`}`);
        res.json({ received: true });
      } catch (err) {
        log.error(`[billing] webhook ${type}: plan refresh failed`, err);
        next(new HttpError(503, "BILLING_SYNC_FAILED", "Temporarily unable to process the event."));
      }
    }
  );

  return router;
}
