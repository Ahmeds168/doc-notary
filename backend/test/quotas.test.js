import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createHarness, fileBuffer } from "./helpers/harness.js";

const post = (h, token) => request(h.app).post("/api/documents/notarize").set("Authorization", `Bearer ${token}`);

test("free plan: 4th notarization in a month is refused before any upload or chain call", async () => {
  const h = await createHarness();
  const { token } = await h.signUp("free");
  for (let i = 0; i < 3; i++) {
    assert.equal((await post(h, token).attach("file", fileBuffer(`doc ${i}`), "d.txt")).status, 201);
  }
  const before = { put: h.storage.calls.put, broadcast: h.chain.calls.broadcast, estimate: h.chain.calls.estimate, verify: h.chain.calls.verify };

  const res = await post(h, token).attach("file", fileBuffer("doc 4"), "d.txt");
  assert.equal(res.status, 402);
  assert.equal(res.body.code, "QUOTA_EXCEEDED");
  assert.equal(res.body.limit, 3);
  assert.deepEqual(
    { put: h.storage.calls.put, broadcast: h.chain.calls.broadcast, estimate: h.chain.calls.estimate, verify: h.chain.calls.verify },
    before
  );

  const me = await request(h.app).get("/api/me").set("Authorization", `Bearer ${token}`);
  assert.deepEqual([me.body.plan, me.body.usage.used, me.body.usage.limit], ["free", 3, 3]);
});

test("standard plan gets 25/month and the history dashboard", async () => {
  const h = await createHarness();
  const { token } = await h.signUp("standard");
  const me = await request(h.app).get("/api/me").set("Authorization", `Bearer ${token}`);
  assert.equal(me.body.entitlements.monthlyNotarizations, 25);
  assert.equal(me.body.entitlements.maxFileSizeBytes, 25 * 1024 * 1024);
  assert.equal(me.body.entitlements.historyDashboard, true);
  assert.equal(me.body.entitlements.support, "email");
});

test("quota is enforced atomically in Postgres even if the preflight count is stale", async () => {
  const h = await createHarness();
  const { token } = await h.signUp("free");
  // Simulate another instance's preflight seeing zero usage while three reservations land.
  const realCount = h.store.countMonthlyUsage;
  h.store.countMonthlyUsage = async () => 0;
  const results = await Promise.all(
    [1, 2, 3, 4, 5].map((i) => post(h, token).attach("file", fileBuffer(`parallel ${i}`), "p.txt"))
  );
  h.store.countMonthlyUsage = realCount;
  const statuses = results.map((r) => r.status);
  // max 2 in flight + 3/month: never more than 3 successes, the rest refused (402/429).
  assert.ok(statuses.filter((s) => s === 201).length <= 3, statuses.join(","));
  assert.ok(statuses.every((s) => [201, 402, 429].includes(s)), statuses.join(","));
  assert.ok(h.chain.calls.broadcast <= 3);
  assert.ok((await h.store.countMonthlyUsage((await h.pg.db.query("select id from auth.users")).rows[0].id)) <= 3);
});

test("free plan 5MB limit: oversize upload rejected from Content-Length before the body is parsed", async () => {
  const h = await createHarness();
  const { token } = await h.signUp("free");
  const big = Buffer.alloc(5 * 1024 * 1024 + 200 * 1024, 1);
  const res = await post(h, token).attach("file", big, "big.bin");
  assert.equal(res.status, 413);
  assert.equal(res.body.code, "FILE_TOO_LARGE");
  assert.equal(h.storage.calls.put, 0);
  assert.equal(h.chain.calls.verify, 0);

  // Just over the limit (within multipart slack): caught by the streaming multer limit instead.
  const edge = await post(h, token).attach("file", Buffer.alloc(5 * 1024 * 1024 + 10, 1), "edge.bin");
  assert.equal(edge.status, 413);
  assert.equal(h.storage.calls.put, 0);
});

test("standard plan accepts files above 5MB", async () => {
  const h = await createHarness();
  const { token } = await h.signUp("standard");
  const res = await post(h, token).attach("file", Buffer.alloc(6 * 1024 * 1024, 2), "six.bin");
  assert.equal(res.status, 201);
});

test("per-user rate limit returns 429 before upload", async () => {
  const h = await createHarness({ env: { RATE_LIMIT_NOTARIZE_PER_MINUTE: "2" } });
  const { token } = await h.signUp("standard");
  assert.equal((await post(h, token).attach("file", fileBuffer("r1"), "r.txt")).status, 201);
  assert.equal((await post(h, token).attach("file", fileBuffer("r2"), "r.txt")).status, 201);
  const putsBefore = h.storage.calls.put;
  const res = await post(h, token).attach("file", fileBuffer("r3"), "r.txt");
  assert.equal(res.status, 429);
  assert.equal(res.body.code, "RATE_LIMITED");
  assert.equal(h.storage.calls.put, putsBefore);
});

test("relayer daily budget blocks new reservations before upload or broadcast", async () => {
  // Budget fits exactly two max-cost reservations.
  const h = await createHarness({ env: { RELAYER_DAILY_BUDGET_ETH: "0.004", RELAYER_MAX_TX_COST_ETH: "0.002" } });
  const { token } = await h.signUp("standard");
  h.chain.autoMine = false; // pending: spend counted at the (estimated) reserved cost
  h.chain.estimateCostWei = 2n * 10n ** 15n; // estimate == per-tx cap (0.002 ETH)
  await post(h, token).attach("file", fileBuffer("b1"), "b.txt");
  await post(h, token).attach("file", fileBuffer("b2"), "b.txt");
  const other = await h.signUp("standard");
  const putsBefore = h.storage.calls.put;
  const broadcastsBefore = h.chain.calls.broadcast;
  const res = await post(h, other.token).attach("file", fileBuffer("b3"), "b.txt");
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "RELAYER_BUDGET_EXHAUSTED");
  assert.equal(h.storage.calls.put, putsBefore);
  assert.equal(h.chain.calls.broadcast, broadcastsBefore);
});

test("per-transaction cost cap refuses to sign when fees spike, and releases the quota", async () => {
  const h = await createHarness();
  const { user, token } = await h.signUp("free");
  h.chain.estimateCostWei = 10n ** 18n; // 1 ETH
  const res = await post(h, token).attach("file", fileBuffer("expensive"), "e.txt");
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "RELAYER_COST_LIMIT");
  assert.equal(h.chain.calls.sign, 0);
  assert.equal(await h.store.countMonthlyUsage(user.id), 0);
  assert.equal(h.storage.objects.size, 0, "uploaded file cleaned up: nothing was ever signed");
});

test("verification is unlimited by plan (no auth, no quota)", async () => {
  const h = await createHarness();
  for (let i = 0; i < 10; i++) {
    const res = await request(h.app).get(`/api/documents/verify/0x${String(i).padStart(64, "0")}`);
    assert.equal(res.status, 200);
  }
});
