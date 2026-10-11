import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import request from "supertest";
import { createHarness, TEST_ENV } from "./helpers/harness.js";
import { loadConfig, secretValues, ConfigError } from "../src/config.js";
import { createKelviqClient, verifyKelviqWebhook, customerIdFromEvent, WebhookVerificationError } from "../src/lib/kelviq.js";

const BILLING_ENV = Object.freeze({
  BILLING_ENABLED: "true",
  KELVIQ_API_KEY: "test-kelviq-api-key-value",
  KELVIQ_WEBHOOK_SECRET: "test-kelviq-webhook-secret",
  KELVIQ_STANDARD_FEATURE_ID: "standard-access",
  FRONTEND_URL: "https://doc-notary.vercel.app",
});

/** In-memory Kelviq. Nothing in these tests reaches the network. */
function createFakeKelviq() {
  const kelviq = {
    standard: new Set(), // customer ids with access to the Standard feature
    known: new Set(),
    calls: [],
    down: false,
    async fetch(url, init = {}) {
      const u = new URL(url);
      const body = init.body ? JSON.parse(init.body) : undefined;
      kelviq.calls.push({ method: init.method, url: u, headers: init.headers, body });
      const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
      if (kelviq.down) throw new TypeError("fetch failed");
      if (u.pathname === "/api/v1/entitlements") {
        const id = u.searchParams.get("customer_id");
        if (!kelviq.known.has(id) && !kelviq.standard.has(id)) return json(404, { detail: "Not found." });
        return json(200, {
          customerId: id,
          entitlements: [
            { featureId: "standard-access", hasAccess: kelviq.standard.has(id), featureType: "BOOLEAN" },
            { featureId: "other", hasAccess: true, featureType: "BOOLEAN" },
          ],
        });
      }
      if (u.pathname === "/api/v1/customers/") {
        if (kelviq.known.has(body.customer_id)) return json(400, { detail: "exists" });
        kelviq.known.add(body.customer_id);
        return json(201, { customerId: body.customer_id });
      }
      if (u.pathname === "/api/v1/checkout/") {
        return json(201, { checkoutUrl: "https://checkout.kelviq.com/s/cs_123", checkoutSessionId: "cs_123" });
      }
      return json(404, {});
    },
  };
  return kelviq;
}

async function billingHarness(env = {}) {
  const kelviq = createFakeKelviq();
  const h = await createHarness({ env: { ...BILLING_ENV, ...env }, kelviqFetch: kelviq.fetch });
  return { ...h, kelviq };
}

function sign(body, { secret = BILLING_ENV.KELVIQ_WEBHOOK_SECRET, id = "msg_1", ts = Math.floor(Date.now() / 1000) } = {}) {
  const sig = createHmac("sha256", secret).update(`${id}.${ts}.${body}`).digest("hex");
  return { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}` };
}

function postWebhook(h, event, headerOverrides) {
  const body = JSON.stringify(event);
  return request(h.app)
    .post("/api/billing/webhooks/kelviq")
    .set("Content-Type", "application/json")
    .set({ ...sign(body), ...headerOverrides })
    .send(body);
}

const me = (h, token) => request(h.app).get("/api/me").set("Authorization", `Bearer ${token}`);

// --- configuration ----------------------------------------------------------------------

test("billing is off by default and the app behaves as before", async () => {
  const config = loadConfig(TEST_ENV);
  assert.equal(config.billing.enabled, false);
  assert.equal(config.entitlements.provider, "local");
  const h = await createHarness();
  const { token } = await h.signUp("standard");
  assert.equal((await me(h, token)).body.plan, "standard");
  assert.equal((await me(h, token)).body.billing.available, false);
  assert.equal((await request(h.app).post("/api/billing/checkout").send({})).status, 404);
});

test("production refuses to start with billing enabled and a Kelviq variable missing (names only)", () => {
  const env = { ...TEST_ENV, ...BILLING_ENV, NODE_ENV: "production", KELVIQ_WEBHOOK_SECRET: "", FRONTEND_URL: "" };
  assert.throws(
    () => loadConfig(env),
    (err) =>
      err instanceof ConfigError &&
      err.problems.includes("KELVIQ_WEBHOOK_SECRET is required when BILLING_ENABLED=true") &&
      err.problems.includes("FRONTEND_URL is required when BILLING_ENABLED=true") &&
      !err.message.includes(BILLING_ENV.KELVIQ_API_KEY)
  );
});

test("outside production a missing Kelviq variable only disables billing with a warning", () => {
  const config = loadConfig({ ...TEST_ENV, ...BILLING_ENV, KELVIQ_API_KEY: "" });
  assert.equal(config.billing.configured, false);
  assert.equal(config.entitlements.provider, "local");
  assert.ok(config.warnings.some((w) => w.includes("KELVIQ_API_KEY")));
});

test("Kelviq defaults: sandbox, standard-plan; invalid KELVIQ_ENV and stray ENTITLEMENTS_PROVIDER rejected", () => {
  const config = loadConfig({ ...TEST_ENV, ...BILLING_ENV });
  assert.equal(config.billing.kelviq.environment, "sandbox");
  assert.equal(config.billing.kelviq.standardPlanId, "standard-plan");
  assert.equal(config.entitlements.provider, "kelviq");
  assert.ok(secretValues(config).includes(BILLING_ENV.KELVIQ_API_KEY));
  assert.ok(secretValues(config).includes(BILLING_ENV.KELVIQ_WEBHOOK_SECRET));
  assert.throws(() => loadConfig({ ...TEST_ENV, ...BILLING_ENV, KELVIQ_ENV: "live" }), /KELVIQ_ENV/);
  assert.throws(() => loadConfig({ ...TEST_ENV, ENTITLEMENTS_PROVIDER: "kelviq" }), /requires BILLING_ENABLED/);
  const prod = loadConfig({ ...TEST_ENV, ...BILLING_ENV, NODE_ENV: "production" });
  assert.ok(prod.warnings.some((w) => w.includes("SANDBOX")));
});

// --- client -----------------------------------------------------------------------------

test("client talks to the sandbox by default and production only when asked", async () => {
  const kelviq = createFakeKelviq();
  await createKelviqClient({ apiKey: "k", fetch: kelviq.fetch }).getEntitlements("c");
  await createKelviqClient({ apiKey: "k", environment: "production", fetch: kelviq.fetch }).getEntitlements("c");
  assert.deepEqual(kelviq.calls.map((c) => c.url.origin), ["https://edge.sandboxapi.kelviq.com", "https://edge.api.kelviq.com"]);
  assert.equal(kelviq.calls[0].headers.Authorization, "Bearer k");
});

test("client errors never contain the API key", async () => {
  const kelviq = createFakeKelviq();
  kelviq.down = true;
  const client = createKelviqClient({ apiKey: "super-secret-key", fetch: kelviq.fetch });
  await assert.rejects(client.getEntitlements("c"), (err) => !err.message.includes("super-secret-key"));
});

// --- webhook verification ---------------------------------------------------------------

test("webhook signature: valid, tampered, wrong secret, missing headers, replayed", () => {
  const body = JSON.stringify({ id: "evt_1", type: "subscription.updated", data: { object: {} } });
  const secret = "s3cret";
  const ok = verifyKelviqWebhook({ rawBody: Buffer.from(body), headers: sign(body, { secret }), secret });
  assert.equal(ok.id, "evt_1");

  const bad = (headers, rawBody = body) => assert.throws(() => verifyKelviqWebhook({ rawBody, headers, secret }), WebhookVerificationError);
  bad(sign(body, { secret }), body.replace("updated", "created"));
  bad(sign(body, { secret: "other" }));
  bad({ ...sign(body, { secret }), "webhook-signature": undefined });
  bad(sign(body, { secret, ts: Math.floor(Date.now() / 1000) - 3600 }));
});

test("customer id is taken from data.object regardless of event type", () => {
  const id = "5b0a2d7e-1c3f-4a5b-9c8d-7e6f5a4b3c2d";
  assert.equal(customerIdFromEvent({ data: { object: { customerId: id } } }), id);
  assert.equal(customerIdFromEvent({ data: { object: { customer: { customer_id: id } } } }), id);
  assert.equal(customerIdFromEvent({ data: { object: { metadata: { userId: id } } } }), id);
  assert.equal(customerIdFromEvent({ data: { object: { customerId: "not-a-uuid" } } }), null);
});

// --- plan resolution --------------------------------------------------------------------

test("Kelviq decides the plan; quotas still come from our catalog and Postgres", async () => {
  const h = await billingHarness();
  const { user, token } = await h.signUp("free");
  assert.equal((await me(h, token)).body.plan, "free");

  h.kelviq.standard.add(user.id);
  // Cached for a minute per instance; a webhook (below) is what makes changes immediate.
  await h.entitlements.refreshPlan(user.id);
  const body = (await me(h, token)).body;
  assert.equal(body.plan, "standard");
  assert.equal(body.usage.limit, 25);
  assert.equal(body.billing.available, true);
  const profile = await h.store.getProfile(user.id);
  assert.deepEqual([profile.plan, profile.plan_source], ["standard", "kelviq"]);
  // Nothing was reported to Kelviq meters.
  assert.ok(h.kelviq.calls.every((c) => c.method === "GET" || c.url.pathname !== "/api/v1/report/"));
});

test("Kelviq outage falls back to the last synced plan", async () => {
  const h = await billingHarness({ KELVIQ_CACHE_TTL_MS: "0" });
  const { user, token } = await h.signUp("free");
  h.kelviq.standard.add(user.id);
  assert.equal((await me(h, token)).body.plan, "standard");
  h.kelviq.down = true;
  const res = await me(h, token);
  assert.equal(res.status, 200);
  assert.equal(res.body.plan, "standard");
});

test("a manual operator override is never replaced by Kelviq", async () => {
  const h = await billingHarness({ KELVIQ_CACHE_TTL_MS: "0" });
  const { user, token } = await h.signUp("free");
  await h.store.setUserPlan(user.id, "standard", "manual");
  assert.equal((await me(h, token)).body.plan, "standard");
  assert.equal((await postWebhook(h, { id: "e", type: "subscription.cancelled", data: { object: { customerId: user.id } } })).status, 200);
  assert.equal((await h.store.getProfile(user.id)).plan_source, "manual");
});

// --- webhook route ----------------------------------------------------------------------

test("verified webhook re-reads the customer from Kelviq and syncs profiles.plan both ways", async () => {
  const h = await billingHarness();
  const { user, token } = await h.signUp("free");
  assert.equal((await me(h, token)).body.plan, "free"); // warm the cache

  h.kelviq.standard.add(user.id);
  const res = await postWebhook(h, { id: "evt_1", type: "checkout.completed", data: { object: { customerId: user.id } } });
  assert.equal(res.status, 200);
  assert.equal((await me(h, token)).body.plan, "standard");

  h.kelviq.standard.delete(user.id);
  h.kelviq.known.add(user.id);
  const res2 = await postWebhook(h, { id: "evt_2", type: "subscription.cancelled", data: { object: { customer: { customerId: user.id } } } });
  assert.equal(res2.status, 200);
  assert.equal((await me(h, token)).body.plan, "free");
});

test("webhook with a bad signature is rejected and changes nothing", async () => {
  const h = await billingHarness();
  const { user } = await h.signUp("free");
  h.kelviq.standard.add(user.id);
  const res = await postWebhook(h, { id: "e", type: "x", data: { object: { customerId: user.id } } }, { "webhook-signature": `v1,${"00".repeat(32)}` });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "INVALID_SIGNATURE");
  assert.equal((await h.store.getProfile(user.id)).plan, "free");
  assert.ok(!h.kelviq.calls.some((c) => c.url.pathname === "/api/v1/entitlements"));
});

test("webhook for an unknown customer or without one is acknowledged and ignored", async () => {
  const h = await billingHarness();
  assert.equal((await postWebhook(h, { id: "e", type: "x", data: { object: { customerId: "5b0a2d7e-1c3f-4a5b-9c8d-7e6f5a4b3c2d" } } })).status, 200);
  assert.equal((await postWebhook(h, { id: "e", type: "x", data: { object: {} } })).body.ignored, "no_customer");
});

test("webhook answers 503 when Kelviq can't be reached, so Kelviq retries", async () => {
  const h = await billingHarness();
  const { user } = await h.signUp("free");
  h.kelviq.down = true;
  const res = await postWebhook(h, { id: "e", type: "x", data: { object: { customerId: user.id } } });
  assert.equal(res.status, 503);
});

// --- checkout ---------------------------------------------------------------------------

test("checkout: auth required, monthly/yearly mapped, customer id = user id, URLs from FRONTEND_URL", async () => {
  const h = await billingHarness();
  const { user, token } = await h.signUp("free");
  assert.equal((await request(h.app).post("/api/billing/checkout").send({ interval: "monthly" })).status, 401);

  const res = await request(h.app).post("/api/billing/checkout").set("Authorization", `Bearer ${token}`).send({ interval: "yearly" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { checkoutUrl: "https://checkout.kelviq.com/s/cs_123", checkoutSessionId: "cs_123" });

  const call = h.kelviq.calls.find((c) => c.url.pathname === "/api/v1/checkout/");
  assert.equal(call.url.origin, "https://sandboxapi.kelviq.com");
  assert.deepEqual(call.body, {
    plan_identifier: "standard-plan",
    charge_period: "YEARLY",
    success_url: "https://doc-notary.vercel.app/?checkout=success",
    cancel_url: "https://doc-notary.vercel.app/?checkout=cancelled",
    customer_id: user.id,
    metadata: { userId: user.id },
  });
  const customer = h.kelviq.calls.find((c) => c.url.pathname === "/api/v1/customers/");
  assert.equal(customer.body.customer_id, user.id);
});

test("checkout: invalid interval 400, already Standard 409, Kelviq down 502", async () => {
  const h = await billingHarness({ KELVIQ_CACHE_TTL_MS: "0" });
  const { user, token } = await h.signUp("free");
  const post = (body) => request(h.app).post("/api/billing/checkout").set("Authorization", `Bearer ${token}`).send(body);
  assert.equal((await post({ interval: "weekly" })).status, 400);

  h.kelviq.standard.add(user.id);
  assert.equal((await post({ interval: "monthly" })).body.code, "ALREADY_SUBSCRIBED");

  h.kelviq.standard.delete(user.id);
  await h.store.setUserPlan(user.id, "free", "kelviq");
  h.kelviq.down = true;
  const res = await post({ interval: "monthly" });
  assert.equal(res.status, 502);
  assert.equal(res.body.code, "CHECKOUT_FAILED");
});

test("billing enabled but not configured (non-production): routes answer 503", async () => {
  const h = await createHarness({ env: { ...BILLING_ENV, KELVIQ_API_KEY: "" } });
  const { token } = await h.signUp("free");
  const res = await request(h.app).post("/api/billing/checkout").set("Authorization", `Bearer ${token}`).send({});
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "BILLING_UNAVAILABLE");
});
