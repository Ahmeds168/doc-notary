import { HttpError } from "./errors.js";

/**
 * Fixed-window in-memory rate limiter.
 *
 * Scope: per process. With N backend instances a client can get up to N× the limit, so this
 * is burst/abuse protection only. The limits that protect money (monthly quota, in-flight
 * cap, relayer daily budget) are enforced atomically in Postgres by reserve_notarization()
 * and therefore hold across instances.
 */
export function createRateLimiter({ limit, windowMs = 60_000, now = () => Date.now() }) {
  const buckets = new Map();
  return {
    /** Returns true if allowed, false if over the limit. */
    hit(key) {
      const t = now();
      let bucket = buckets.get(key);
      if (!bucket || t >= bucket.resetAt) {
        bucket = { count: 0, resetAt: t + windowMs };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      if (buckets.size > 10_000) {
        for (const [k, b] of buckets) if (t >= b.resetAt) buckets.delete(k);
      }
      return bucket.count <= limit;
    },
  };
}

/** Express middleware. keyFn(req) picks the identity (user id when authenticated, else IP). */
export function rateLimit({ limit, windowMs, keyFn, now }) {
  const limiter = createRateLimiter({ limit, windowMs, now });
  return (req, _res, next) => {
    if (limiter.hit(keyFn(req))) return next();
    next(new HttpError(429, "RATE_LIMITED", "Too many requests. Please slow down and try again shortly."));
  };
}
