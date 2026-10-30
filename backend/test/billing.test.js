import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import request from "supertest";
import { createHarness } from "./helpers/harness.js";
import { createKelviqClient, verifyKelviqWebhook, KelviqError } from "../src/lib/kelviq.js";
import { subscriptionGrantsPlan, findCustomerId } from "../src/services/billing.js";

const WEBHOOK_SECRET = "test-webhook-secret-value";

/** In-memory stand-in for Kelviq: customers, subscriptions and recorded calls. */
function createFakeKelviq() {
  const customers = new Map();
  const subscriptions = new Map(); // customerId -> [sub]
  const calls = [];
  const notFound = () => new KelviqError("Not found", 404);
  return {
    customers,
    subscriptions,
    calls,
    failNext: null,
    async getCustomer(id) {
      calls.push(["getCustomer", id]);
      if (!customers.has(id)) throw notFound();
      return customers.get(id);
    },
    async createCustomer(c) {
      calls.push(["createCustomer", c]);
      customers.set(c.customerId, { customer_id: c.customerId, email: c.email });
      return customers.get(c.customerId);
    },
    async updateCustomer(c) {
      calls.push(["updateCustomer", c]);
      customers.set(c.customerId, { ...customers.get(c.customerId), email: c.email });
      return customers.get(c.customerId);
    },
    async createCheckoutSession(p) {
      calls.push(["createCheckoutSession", p]);
      return { checkout_session_id: "cs_1", checkout_url: `https://checkout.kelviq.test/${p.customerId}` };
    },
    async listSubscriptions({ customerId }) {
      calls.push(["listSubscriptions", customerId]);
      if (this.failNext) {
        const err = this.failNext;
        this.failNext = null;
        throw err;
      }
      return { count: 0, results: subscriptions.get(customerId) ?? [] };
    },
    async createPortalSession({ customerId }) {
      calls.push(["createPortalSession", customerId]);
      return { token: "tok_portal", email: "x@example.com", customer_portal_url: `https://portal.kelviq.test/${customerId}` };
    },
  };
}

const activeSub = (overrides = {}) => ({ status: "ACTIVE", plan: { identifier: "standard-plan" }, ...overrides });

async function setup(opts = {}) {
  const kelviq = opts.kelviq === undefined ? createFakeKelviq() : opts.kelviq;
  const h = await createHarness({ kelviq, env: { KELVIQ_WEBHOOK_SECRET: WEBHOOK_SECRET, ...opts.env } });
  return { ...h, kelviq };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

test("checkout creates the Kelviq customer from the user and returns the hosted checkout URL", async () => {
  const h = await setup();
  const { user, token } = await h.signUp();

  const res = await request(h.app).post("/api/billing/checkout").set(auth(token)).send({ period: "yearly" });
  assert.equal(res.status, 200);
  assert.equal(res.body.url, `https://checkout.kelviq.test/${user.id}`);

  assert.deepEqual(h.kelviq.customers.get(user.id), { customer_id: user.id, email: user.email });
  const [, session] = h.kelviq.calls.find(([name]) => name === "createCheckoutSession");
  assert.equal(session.planIdentifier, "standard-plan");
  assert.equal(session.chargePeriod, "YEARLY");
  assert.equal(session.customerId, user.id);
  assert.equal(session.successUrl, "https://doc-notary.vercel.app/?checkout=success");
});

test("the funnel counts checkout starts, returns and upgrades without storing who", async () => {
  const h = await setup();
  const { user, token } = await h.signUp();
  await request(h.app).post("/api/billing/checkout").set(auth(token)).send({ period: "yearly" });
  h.kelviq.subscriptions.set(user.id, [activeSub()]);
  await request(h.app).post("/api/billing/sync?from=checkout").set(auth(token));
  await new Promise((r) => setTimeout(r, 20)); // best-effort writes are not awaited
  const { rows } = await h.pg.db.query("select event, period from funnel_events order by id");
  assert.deepEqual(rows, [
    { event: "checkout_started", period: "yearly" },
    { event: "checkout_returned", period: null },
    { event: "upgraded", period: null },
  ]);
  const { rows: cols } = await h.pg.db.query("select column_name from information_schema.columns where table_name = 'funnel_events'");
  assert.deepEqual(cols.map((c) => c.column_name).sort(), ["created_at", "event", "id", "period"]);
});

test("checkout rejects bad periods, anonymous users, existing subscribers, and missing configuration", async () => {
  const h = await setup();
  const { token } = await h.signUp();
  assert.equal((await request(h.app).post("/api/billing/checkout").send({ period: "monthly" })).status, 401);
  const bad = await request(h.app).post("/api/billing/checkout").set(auth(token)).send({ period: "weekly" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "INVALID_PERIOD");

  const paid = await h.signUp("standard");
  const dup = await request(h.app).post("/api/billing/checkout").set(auth(paid.token)).send({ period: "monthly" });
  assert.equal(dup.status, 409);

  const off = await setup({ kelviq: null });
  const u = await off.signUp();
  const res = await request(off.app).post("/api/billing/checkout").set(auth(u.token)).send({ period: "monthly" });
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "BILLING_UNAVAILABLE");
});

test("a paid subscription upgrades the account, and a refund or expiry moves it back to Free", async () => {
  const h = await setup();
  const { user, token } = await h.signUp();

  h.kelviq.subscriptions.set(user.id, [activeSub()]);
  const sync = await request(h.app).post("/api/billing/sync").set(auth(token));
  assert.equal(sync.body.plan, "standard");
  const me = await request(h.app).get("/api/me").set(auth(token));
  assert.equal(me.body.plan, "standard");
  assert.equal(me.body.entitlements.monthlyNotarizations, 25);
  assert.equal((await h.store.getProfile(user.id)).plan_source, "kelviq");

  h.kelviq.subscriptions.set(user.id, [activeSub({ status: "REFUNDED" })]);
  assert.equal((await request(h.app).post("/api/billing/sync").set(auth(token))).body.plan, "free");
  assert.equal((await request(h.app).get("/api/me").set(auth(token))).body.plan, "free");
});

test("a cancelled subscription keeps Standard until the paid period ends", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  const cancelled = (end) => activeSub({ status: "CANCELLED", billing_period_end_time: end });
  assert.equal(subscriptionGrantsPlan(cancelled("2026-11-30T00:00:00Z"), "standard-plan", now), true);
  assert.equal(subscriptionGrantsPlan(cancelled("2026-11-01T00:00:00Z"), "standard-plan", now), false);
  assert.equal(subscriptionGrantsPlan(activeSub({ plan: { identifier: "fee-plan" } }), "standard-plan", now), false);
  assert.equal(subscriptionGrantsPlan(activeSub({ status: "past_due" }), "standard-plan", now), true);
});

test("/api/me re-checks Kelviq at most once per interval and survives a Kelviq outage", async () => {
  const h = await setup();
  const { user, token } = await h.signUp();
  const lists = () => h.kelviq.calls.filter(([n]) => n === "listSubscriptions").length;

  await request(h.app).get("/api/me").set(auth(token));
  await request(h.app).get("/api/me").set(auth(token));
  assert.equal(lists(), 1, "second call within the interval is served from the stored plan");

  // A forced sync during an outage reports the error but leaves the stored plan alone.
  await h.store.setUserPlan(user.id, "standard", "kelviq");
  h.kelviq.failNext = new KelviqError("Bad gateway", 502);
  assert.equal((await request(h.app).post("/api/billing/sync").set(auth(token))).status, 502);
  assert.equal((await h.store.getProfile(user.id)).plan, "standard");

  // /api/me during an outage: still answers, from the stored plan.
  h.kelviq.failNext = new KelviqError("Bad gateway", 502);
  const me = await request(h.app).get("/api/me").set(auth(token));
  assert.equal(me.status, 200);
  assert.equal(me.body.plan, "standard");
});

test("plans set by hand are never overwritten by the sync", async () => {
  const h = await setup();
  const { user, token } = await h.signUp();
  await h.store.setUserPlan(user.id, "standard", "manual");
  assert.equal((await request(h.app).post("/api/billing/sync").set(auth(token))).body.plan, "standard");
  assert.equal((await h.store.getProfile(user.id)).plan_source, "manual");
});

test("portal returns Kelviq's signed-in portal link, first giving the customer an email", async () => {
  const h = await setup();
  const { user, token } = await h.signUp();
  h.kelviq.customers.set(user.id, { customer_id: user.id, email: null }); // e.g. created elsewhere without one
  const res = await request(h.app).post("/api/billing/portal").set(auth(token));
  assert.equal(res.body.url, `https://portal.kelviq.test/${user.id}?token=tok_portal`);
  assert.equal(h.kelviq.customers.get(user.id).email, user.email);
});

function signed(body, { secret = WEBHOOK_SECRET, id = "msg_1", ts = Math.floor(Date.now() / 1000) } = {}) {
  const sig = createHmac("sha256", secret).update(`${id}.${ts}.${body}`).digest("hex");
  return { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}`, "content-type": "application/json" };
}

test("a verified webhook re-syncs that customer; forged or stale ones are rejected", async () => {
  const h = await setup();
  const { user, token } = await h.signUp();
  h.kelviq.subscriptions.set(user.id, [activeSub()]);

  const body = JSON.stringify({ type: "subscription.created", data: { customer: { customer_id: user.id } } });
  const ok = await request(h.app).post("/api/billing/webhook").set(signed(body)).send(body);
  assert.equal(ok.status, 200);
  assert.equal((await h.store.getProfile(user.id)).plan, "standard");

  const forged = await request(h.app).post("/api/billing/webhook").set(signed(body, { secret: "wrong-secret" })).send(body);
  assert.equal(forged.status, 400);
  const stale = await request(h.app).post("/api/billing/webhook").set(signed(body, { ts: Math.floor(Date.now() / 1000) - 3600 })).send(body);
  assert.equal(stale.status, 400);

  // The webhook doesn't trust its payload: plan comes from Kelviq's API.
  h.kelviq.subscriptions.set(user.id, []);
  const lie = JSON.stringify({ type: "subscription.created", data: { customer_id: user.id, status: "active" } });
  await request(h.app).post("/api/billing/webhook").set(signed(lie, { id: "msg_2" })).send(lie);
  assert.equal((await h.store.getProfile(user.id)).plan, "free");
  assert.ok(token);
});

test("webhooks answer 503 when no secret is configured", async () => {
  const h = await createHarness({ kelviq: createFakeKelviq() });
  const res = await request(h.app).post("/api/billing/webhook").send("{}");
  assert.equal(res.status, 503);
});

test("findCustomerId only accepts our user ids", () => {
  const id = "3f2b9c1e-8d4a-4b6f-9e2a-1c5d7e9f0a1b";
  assert.equal(findCustomerId({ data: { customerId: id } }), id);
  assert.equal(findCustomerId({ data: { customer: { id: "kelviq-internal", customer_id: id } } }), id);
  assert.equal(findCustomerId({ data: { customer_id: "not-a-uuid" } }), null);
});

test("Kelviq client sends snake_case with the bearer key and never puts the key in errors", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    if (String(url).includes("/subscriptions/")) return new Response(JSON.stringify({ detail: "nope" }), { status: 401 });
    return new Response(JSON.stringify({ checkout_url: "https://x" }), { status: 200 });
  };
  const client = createKelviqClient({ apiKey: "sk_live_secret_value", fetchImpl });
  await client.createCheckoutSession({ planIdentifier: "standard-plan", chargePeriod: "MONTHLY", customerId: "u1", successUrl: "https://a" });
  assert.equal(seen[0].url, "https://api.kelviq.com/api/v1/checkout/");
  assert.equal(seen[0].init.headers.Authorization, "Bearer sk_live_secret_value");
  assert.deepEqual(JSON.parse(seen[0].init.body), { plan_identifier: "standard-plan", charge_period: "MONTHLY", customer_id: "u1", success_url: "https://a" });

  const err = await client.listSubscriptions({ customerId: "u1" }).catch((e) => e);
  assert.equal(err.status, 401);
  assert.match(seen[1].url, /\/api\/v1\/subscriptions\/\?customer_id=u1&page_size=50$/);
  assert.ok(!String(err.message).includes("sk_live"));
});

test("webhook verification accepts rotated signatures and millisecond timestamps", () => {
  const body = '{"a":1}';
  const ts = Date.now();
  const good = createHmac("sha256", WEBHOOK_SECRET).update(`m.${ts}.${body}`).digest("hex");
  const headers = { "webhook-id": "m", "webhook-timestamp": String(ts), "webhook-signature": `v1,deadbeef v1,${good}` };
  assert.deepEqual(verifyKelviqWebhook(body, headers, WEBHOOK_SECRET), { a: 1 });
});
