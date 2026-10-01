import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createHarness, fileBuffer } from "./helpers/harness.js";

const post = (h, token, text) =>
  request(h.app).post("/api/documents/notarize").set("Authorization", `Bearer ${token}`).attach("file", fileBuffer(text), "f.txt");

test("concurrent submissions of the same file by the same user send exactly one transaction", async () => {
  const h = await createHarness();
  const { user, token } = await h.signUp("standard");
  const results = await Promise.all([1, 2, 3, 4].map(() => post(h, token, "same bytes")));
  assert.equal(h.chain.calls.broadcast, 1);
  assert.equal(new Set(results.map((r) => r.body.documentHash)).size, 1);
  for (const r of results) assert.ok([201, 202].includes(r.status), `${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(new Set(results.map((r) => r.body.operationId)).size, 1);
  assert.equal(await h.store.countMonthlyUsage(user.id), 1);
});

test("same file by two different users concurrently: one wins, the other gets 409, one tx", async () => {
  const h = await createHarness();
  const a = await h.signUp("standard");
  const b = await h.signUp("standard");
  const [ra, rb] = await Promise.all([post(h, a.token, "contested"), post(h, b.token, "contested")]);
  const statuses = [ra.status, rb.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  assert.equal(h.chain.calls.broadcast, 1);
});

test("re-submitting a confirmed file returns the existing result without a new tx or quota use", async () => {
  const h = await createHarness();
  const { user, token } = await h.signUp();
  const first = await post(h, token, "once");
  const again = await post(h, token, "once");
  assert.equal(again.status, 201);
  assert.equal(again.body.operationId, first.body.operationId);
  assert.equal(h.chain.calls.broadcast, 1);
  assert.equal(await h.store.countMonthlyUsage(user.id), 1);
});

test("a hash already on-chain without an operation (legacy) is rejected before reserving or uploading", async () => {
  const h = await createHarness();
  const { user, token } = await h.signUp();
  const { hashBuffer } = await import("../src/lib/contract.js");
  h.chain.seedRecord(hashBuffer(fileBuffer("old")));
  const res = await post(h, token, "old");
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "ALREADY_NOTARIZED");
  assert.equal(h.storage.calls.put, 0);
  assert.equal(await h.store.countMonthlyUsage(user.id), 0);
});
