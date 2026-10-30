import express from "express";
import { requireAuth } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";
import { verifyKelviqWebhook } from "../lib/kelviq.js";
import { rateLimit } from "../lib/rateLimit.js";

/**
 * /api/billing — Kelviq checkout, customer portal and plan sync (signed-in users).
 *   POST /checkout { period: "monthly" | "yearly" } -> { url }  (Kelviq hosted checkout)
 *   POST /portal                                    -> { url }  (manage / cancel)
 *   POST /sync                                      -> { plan } (after returning from checkout)
 */
export function createBillingRouter({ auth, billing, log }) {
  const router = express.Router();
  const authed = requireAuth(auth, log);
  // Each call hits Kelviq's API; a person needs a handful at most.
  const limiter = rateLimit({ limit: 10, keyFn: (req) => `billing:${req.user.id}` });

  const kelviqFailure = (what) => (err) => {
    if (err instanceof HttpError) throw err;
    log.error(`[billing] ${what} failed`, err);
    throw new HttpError(502, "BILLING_ERROR", "Couldn't reach our payment provider. Please try again in a minute.");
  };

  router.post("/checkout", authed, limiter, async (req, res, next) => {
    try {
      const period = String(req.body?.period ?? "monthly");
      res.json(await billing.createCheckout(req.user, period).catch(kelviqFailure("checkout")));
    } catch (err) {
      next(err);
    }
  });

  router.post("/portal", authed, limiter, async (req, res, next) => {
    try {
      res.json(await billing.createPortal(req.user).catch(kelviqFailure("portal")));
    } catch (err) {
      next(err);
    }
  });

  router.post("/sync", authed, limiter, async (req, res, next) => {
    try {
      // The frontend calls this only on return from Kelviq checkout.
      if (req.query.from === "checkout") billing.funnel("checkout_returned");
      const plan = await billing.syncPlan(req.user.id, { force: true }).catch(kelviqFailure("sync"));
      res.json({ plan });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * POST /api/billing/webhook — Kelviq events, signature-verified. Needs the raw body, so it
 * is mounted before express.json(). Each event only triggers a re-sync of that customer
 * from the Kelviq API, so a forged-but-valid-looking payload can't grant a plan by itself.
 */
export function createBillingWebhookHandler({ config, billing, log }) {
  return [
    express.raw({ type: "*/*", limit: "256kb" }),
    async (req, res) => {
      const secret = config.billing.kelviqWebhookSecret;
      if (!secret || !billing.enabled) return res.status(503).json({ error: "Webhooks are not configured.", code: "BILLING_UNAVAILABLE" });
      let event;
      try {
        event = verifyKelviqWebhook(req.body ?? Buffer.alloc(0), req.headers, secret);
      } catch (err) {
        log.warn(`[billing] rejected webhook: ${err.message}`);
        return res.status(400).json({ error: "Invalid webhook.", code: "INVALID_WEBHOOK" });
      }
      try {
        await billing.handleWebhookEvent(event);
        res.json({ received: true });
      } catch (err) {
        log.error("[billing] webhook handling failed", err);
        // Non-2xx so Kelviq retries later.
        res.status(500).json({ error: "Webhook handling failed.", code: "INTERNAL" });
      }
    },
  ];
}
