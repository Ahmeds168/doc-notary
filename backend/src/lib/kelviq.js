import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal Kelviq REST client (server-side only). Mirrors the wire format of Kelviq's
 * official SDKs (@kelviq/node-sdk, kelviq-sdk): Bearer auth, snake_case request bodies
 * and query params, camelCase responses.
 *
 * Kelviq is only the source of truth for WHICH PLAN a user is on. Quota counting stays
 * in Postgres (reserve_notarization); nothing here reports usage to Kelviq meters.
 */

export const KELVIQ_URLS = Object.freeze({
  sandbox: Object.freeze({ api: "https://sandboxapi.kelviq.com/api/v1", edge: "https://edge.sandboxapi.kelviq.com/api/v1" }),
  production: Object.freeze({ api: "https://api.kelviq.com/api/v1", edge: "https://edge.api.kelviq.com/api/v1" }),
});

export const CHARGE_PERIODS = Object.freeze({ monthly: "MONTHLY", yearly: "YEARLY" });

export class KelviqError extends Error {
  /** status is undefined for network errors and timeouts. Messages never include the API key. */
  constructor(message, status) {
    super(message);
    this.name = "KelviqError";
    this.status = status;
  }
}

export function createKelviqClient({ apiKey, environment = "sandbox", timeoutMs = 10_000, fetch = globalThis.fetch }) {
  const urls = KELVIQ_URLS[environment];
  if (!urls) throw new Error(`Unknown Kelviq environment "${environment}"`);

  async function request(method, url, body) {
    let res;
    try {
      const init = {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      };
      if (body) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      res = await fetch(url, init);
    } catch (err) {
      throw new KelviqError(`Kelviq ${method} ${new URL(url).pathname} failed: ${err?.name ?? "network error"}`);
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON error page; status alone is enough.
    }
    if (!res.ok) {
      throw new KelviqError(`Kelviq ${method} ${new URL(url).pathname} returned ${res.status}`, res.status);
    }
    return data ?? {};
  }

  return {
    environment,

    /**
     * Best-effort: make sure the customer exists with an email, which hosted checkout needs.
     * Kelviq rejects a duplicate customer id with a 4xx, so callers treat 4xx as "already exists".
     */
    async createCustomer({ customerId, email }) {
      return request("POST", `${urls.api}/customers/`, { customer_id: customerId, email });
    },

    /** POST /checkout/ → { checkoutUrl, checkoutSessionId }. */
    async createCheckoutSession({ customerId, planIdentifier, chargePeriod, successUrl, cancelUrl, metadata }) {
      const data = await request("POST", `${urls.api}/checkout/`, {
        plan_identifier: planIdentifier,
        charge_period: chargePeriod,
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_id: customerId,
        metadata,
      });
      const checkoutUrl = data.checkoutUrl ?? data.checkout_url;
      const checkoutSessionId = data.checkoutSessionId ?? data.checkout_session_id ?? null;
      let parsed;
      try {
        parsed = new URL(checkoutUrl);
      } catch {
        throw new KelviqError("Kelviq checkout response did not include a valid checkoutUrl");
      }
      if (parsed.protocol !== "https:") throw new KelviqError("Kelviq checkoutUrl is not https");
      return { checkoutUrl: parsed.toString(), checkoutSessionId };
    },

    /**
     * GET edge /entitlements?customer_id=… → [{ featureId, hasAccess, … }].
     * A customer Kelviq has never seen (404) simply has no entitlements.
     */
    async getEntitlements(customerId) {
      const url = `${urls.edge}/entitlements?customer_id=${encodeURIComponent(customerId)}`;
      let data;
      try {
        data = await request("GET", url);
      } catch (err) {
        if (err instanceof KelviqError && err.status === 404) return [];
        throw err;
      }
      if (!Array.isArray(data.entitlements)) throw new KelviqError("Kelviq entitlements response is malformed");
      return data.entitlements.map((e) => ({
        featureId: e.featureId ?? e.feature_id,
        hasAccess: (e.hasAccess ?? e.has_access) === true,
      }));
    },
  };
}

export class WebhookVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

/**
 * Verify a Kelviq webhook. Same scheme as Kelviq's SDK validateEvent():
 *   webhook-signature: "v1,<hex>"  where  hex = HMAC-SHA256(secret, `${webhook-id}.${webhook-timestamp}.${rawBody}`)
 * plus a timestamp tolerance so a captured delivery can't be replayed later.
 * Returns the parsed event. rawBody must be the exact bytes received.
 */
export function verifyKelviqWebhook({ rawBody, headers, secret, toleranceSeconds = 300, now = Date.now() }) {
  const webhookId = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatureHeader = headers["webhook-signature"];
  if (!webhookId || !timestamp || !signatureHeader) throw new WebhookVerificationError("Missing webhook headers");

  // Standard is seconds; tolerate milliseconds just in case.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new WebhookVerificationError("Invalid webhook timestamp");
  const tsMs = ts > 1e12 ? ts : ts * 1000;
  if (Math.abs(now - tsMs) > toleranceSeconds * 1000) throw new WebhookVerificationError("Webhook timestamp outside tolerance");

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? "");
  const expected = createHmac("sha256", secret).update(`${webhookId}.${timestamp}.${body}`, "utf8").digest();

  // Accept a space-separated list of signatures (key rotation), like Standard Webhooks.
  const ok = String(signatureHeader)
    .split(" ")
    .filter((s) => s.startsWith("v1,"))
    .some((s) => {
      const given = Buffer.from(s.slice(3), "hex");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
  if (!ok) throw new WebhookVerificationError("Webhook signature mismatch");

  try {
    return JSON.parse(body);
  } catch {
    throw new WebhookVerificationError("Webhook body is not JSON");
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Kelviq customerId IS the Supabase user id. Pull it from an event's data.object
 * without depending on the event type, so new or renamed event types still sync.
 */
export function customerIdFromEvent(event) {
  const obj = event?.data?.object ?? {};
  const customer = obj.customer;
  const candidates = [
    obj.customerId,
    obj.customer_id,
    typeof customer === "string" ? customer : undefined,
    customer?.customerId,
    customer?.customer_id,
    obj.metadata?.userId,
  ];
  return candidates.find((c) => typeof c === "string" && UUID_RE.test(c)) ?? null;
}
