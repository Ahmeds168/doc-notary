import express from "express";
import cors from "cors";
import { createDocumentsRouter } from "./routes/documents.js";
import { requireAuth } from "./lib/auth.js";
import { HttpError } from "./lib/errors.js";
import { startOfUtcMonth } from "./lib/supabase.js";

const LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/** Exact-match allowlist from CORS_ORIGIN, plus localhost when enabled. */
export function isOriginAllowed(origin, corsConfig) {
  if (corsConfig.origins.includes(origin)) return true;
  return corsConfig.allowLocalhost && LOCALHOST_RE.test(origin);
}

/**
 * Build the Express app from injected dependencies, so tests can run it against mocks
 * (no live chain, R2 or Supabase).
 */
export function createApp({ config, store, chain, storage, auth, entitlements, notarization, log }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  app.use(
    cors({
      // Requests without an Origin header (curl, server-to-server) are not subject to CORS.
      origin: (origin, callback) => callback(null, !origin || isOriginAllowed(origin, config.cors)),
      allowedHeaders: ["Authorization", "Content-Type"],
      methods: ["GET", "POST", "OPTIONS"],
      maxAge: 600,
    })
  );
  app.use(express.json({ limit: "16kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "doc-notary-backend" });
  });

  app.get("/api/stats", async (_req, res, next) => {
    try {
      res.json({ totalNotarized: await chain.totalNotarized() });
    } catch (err) {
      log.error("[stats] chain read failed", err);
      next(new HttpError(503, "CHAIN_UNAVAILABLE", "Stats are temporarily unavailable."));
    }
  });

  /** GET /api/me — the signed-in user's plan, entitlements and this month's usage. */
  app.get("/api/me", requireAuth(auth, log), async (req, res, next) => {
    try {
      const [ent, used] = await Promise.all([
        entitlements.getEntitlements(req.user.id),
        store.countMonthlyUsage(req.user.id),
      ]);
      res.json({
        user: req.user,
        plan: ent.plan,
        entitlements: ent,
        usage: { used, limit: ent.monthlyNotarizations, periodStart: startOfUtcMonth().toISOString() },
      });
    } catch (err) {
      log.error("[me] lookup failed", err);
      next(new HttpError(503, "ACCOUNT_UNAVAILABLE", "Couldn't load your account. Please try again shortly."));
    }
  });

  app.use(
    "/api/documents",
    createDocumentsRouter({ config, store, chain, storage, auth, entitlements, notarization, log })
  );

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
    }
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
      return res.status(400).json({ error: "Invalid request body.", code: "INVALID_BODY" });
    }
    // Never leak internals: log a redacted summary, return a generic message.
    log.error("[unhandled]", err);
    res.status(500).json({ error: "Internal server error.", code: "INTERNAL" });
  });

  return app;
}
