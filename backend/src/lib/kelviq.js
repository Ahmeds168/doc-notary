import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal Kelviq REST client (server-side only).
 *
 * Mirrors the endpoints used by Kelviq's official Node SDK (@kelviq/node-sdk 2.9):
 * requests go to {baseUrl}/api/v1/<module>/ with a Bearer server API key, and bodies and
 * query parameters are snake_case. Responses are read tolerantly (snake_case or camelCase).
 * The API key is never logged or returned.
 */

export class KelviqError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = "KelviqError";
    this.status = status;
    this.details = details;
  }
}

const snake = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toSnake = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [snake(k), v]));

/** Read a field that may come back as snake_case or camelCase. */
export function pick(obj, camelKey) {
  if (!obj || typeof obj !== "object") return undefined;
  return obj[camelKey] ?? obj[snake(camelKey)];
}

export function createKelviqClient({ apiKey, baseUrl = "https://api.kelviq.com", timeoutMs = 10_000, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("Kelviq API key is required.");
  const root = `${baseUrl.replace(/\/$/, "")}/api/v1`;

  async function request(method, path, { body, query } = {}) {
    const url = new URL(`${root}${path}`);
    if (query) for (const [k, v] of Object.entries(toSnake(query))) url.searchParams.set(k, String(v));
    const res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(toSnake(body)) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.slice(0, 200) };
    }
    if (!res.ok) {
      const message = (data && (data.message || data.detail)) || `Kelviq request failed (${res.status})`;
      throw new KelviqError(typeof message === "string" ? message : `Kelviq request failed (${res.status})`, res.status, data);
    }
    return data;
  }

  return {
    getCustomer: (customerId) => request("GET", `/customers/${encodeURIComponent(customerId)}/`),
    createCustomer: ({ customerId, email, name }) => request("POST", "/customers/", { body: { customerId, email, name } }),
    createCheckoutSession: (params) => request("POST", "/checkout/", { body: params }),
    listSubscriptions: ({ customerId }) => request("GET", "/subscriptions/", { query: { customerId, pageSize: 50 } }),
    createPortalSession: ({ customerId }) => request("POST", "/portal/session/", { body: { customerId } }),
  };
}

/**
 * Verify a Kelviq webhook (same scheme as the official SDK's validateEvent): the
 * `webhook-signature` header is "v1,<hex HMAC-SHA256 of `${id}.${timestamp}.${body}`>".
 * Returns the parsed event, or throws.
 */
export function verifyKelviqWebhook(rawBody, headers, secret, { now = Date.now(), toleranceSeconds = 600 } = {}) {
  const get = (name) => {
    const v = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const id = get("webhook-id");
  const timestamp = get("webhook-timestamp");
  const signature = get("webhook-signature");
  if (!id || !timestamp || !signature) throw new KelviqError("Missing webhook signature headers.", 400);

  let ts = Number(timestamp);
  if (ts > 1e12) ts /= 1000; // tolerate millisecond timestamps
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > toleranceSeconds) {
    throw new KelviqError("Webhook timestamp is outside the allowed window.", 400);
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
  const expected = createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`, "utf8").digest();
  // The header may carry several space-separated signatures (key rotation).
  const ok = signature.split(" ").some((part) => {
    if (!part.startsWith("v1,")) return false;
    const given = Buffer.from(part.slice(3), "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) throw new KelviqError("Webhook signature verification failed.", 400);
  return JSON.parse(body);
}
