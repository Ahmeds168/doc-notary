import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createHarness, fileBuffer } from "./helpers/harness.js";
import { hashBuffer } from "../src/lib/contract.js";

const post = (h, token, text, name = "f.txt") =>
  request(h.app).post("/api/documents/notarize").set("Authorization", `Bearer ${token}`).attach("file", fileBuffer(text), name);

test("tx confirms but DB insert fails → reported confirmed/pending-metadata; retry indexes without a 2nd tx", async () => {
  const h = await createHarness();
  const { user, token } = await h.signUp();
  h.pg.faults.set("upsertDocument", 1);

  const first = await post(h, token, "db goes down after the tx");
  assert.equal(first.status, 201);
  assert.equal(first.body.outcome, "confirmed");
  assert.equal(first.body.metadataStatus, "pending");
  assert.equal(await h.store.getDocumentByHash(first.body.documentHash), null);

  const retry = await post(h, token, "db goes down after the tx");
  assert.equal(retry.status, 201);
  assert.equal(retry.body.metadataStatus, "available");
  assert.equal(retry.body.operationId, first.body.operationId);
  assert.equal(h.chain.calls.broadcast, 1, "retry must not send another transaction");

  const doc = await h.store.getDocumentByHash(first.body.documentHash);
  assert.equal(doc.user_id, user.id);
  assert.equal(doc.tx_hash, first.body.txHash);
  assert.equal(await h.store.countMonthlyUsage(user.id), 1, "retry did not consume extra quota");
});

test("tx confirms but DB insert fails → background reconciler repairs the record", async () => {
  const h = await createHarness();
  const { token } = await h.signUp();
  h.pg.faults.set("upsertDocument", 1);
  const res = await post(h, token, "reconciler repairs me");
  assert.equal(res.body.metadataStatus, "pending");

  await h.notarization.reconcileOnce({ minAgeMs: -1000 });
  const doc = await h.store.getDocumentByHash(res.body.documentHash);
  assert.ok(doc);
  assert.equal((await h.store.getOperation(res.body.operationId)).indexed, true);
});

test("DB fully down after broadcast: tx hash was persisted before broadcast, reconciler finishes the job", async () => {
  const h = await createHarness();
  const { token } = await h.signUp();
  // Let the reservation, upload and 'broadcasting' write succeed, then take the DB down.
  const realBroadcast = h.chain.broadcast;
  h.chain.broadcast = async (raw) => {
    await realBroadcast(raw);
    h.pg.faults.set("updateOperation", Infinity);
    h.pg.faults.set("upsertDocument", Infinity);
  };
  const res = await post(h, token, "db outage mid-flight");
  assert.equal(res.status, 201);
  assert.equal(res.body.outcome, "confirmed");
  assert.equal(res.body.metadataStatus, "pending");
  const stored = await h.store.getOperation(res.body.operationId);
  assert.equal(stored.status, "broadcasting");
  assert.ok(stored.tx_hash);

  h.pg.faults.clear();
  await h.notarization.reconcileOnce({ minAgeMs: -1000 });
  const after = await h.store.getOperation(res.body.operationId);
  assert.equal(after.status, "confirmed");
  assert.equal(after.indexed, true);
  assert.equal(h.chain.calls.broadcast, 1);
});

test("receipt timeout → 202 pending; later mined → confirmed via polling", async () => {
  const h = await createHarness({ chainOptions: { autoMine: false } });
  const { token } = await h.signUp();
  const res = await post(h, token, "slow block");
  assert.equal(res.status, 202);
  assert.equal(res.body.outcome, "pending");

  h.chain.mine();
  const poll = await request(h.app).get(`/api/documents/operations/${res.body.operationId}`).set("Authorization", `Bearer ${token}`);
  assert.equal(poll.body.outcome, "confirmed");
  assert.equal(poll.body.metadataStatus, "available");
});

test("ambiguous broadcast error → uncertain; file kept; resolves to confirmed if the tx actually landed", async () => {
  const h = await createHarness();
  const { token } = await h.signUp();
  h.chain.fail.broadcast = Object.assign(new Error("socket hang up"), { code: "NETWORK_ERROR", reachedNode: true });
  h.chain.autoMine = false;
  const res = await post(h, token, "maybe sent");
  assert.equal(res.status, 202);
  assert.equal(res.body.outcome, "uncertain");
  assert.equal(h.storage.objects.size, 1);
  assert.equal(h.storage.calls.delete, 0);

  // Reconciler while still unknown: stays uncertain, file untouched.
  h.chain.fail = {};
  await h.notarization.reconcileOnce({ minAgeMs: -1000 });
  assert.equal(h.storage.calls.delete, 0);

  h.chain.mine();
  await h.notarization.reconcileOnce({ minAgeMs: -1000 });
  const op = await h.store.getOperation(res.body.operationId);
  assert.equal(op.status, "confirmed");
  assert.equal(op.indexed, true);
  assert.equal(h.storage.calls.delete, 0);
});

test("uncertain tx whose nonce was consumed by another tx → failed (quota released), file still not deleted", async () => {
  const h = await createHarness();
  const { user, token } = await h.signUp();
  h.chain.fail.broadcast = Object.assign(new Error("timeout"), { code: "TIMEOUT" }); // never reached node
  const res = await post(h, token, "dropped");
  assert.equal(res.body.outcome, "uncertain");
  h.chain.fail = {};
  h.chain.consumeNonce();
  await h.notarization.reconcileOnce({ minAgeMs: -1000 });
  const op = await h.store.getOperation(res.body.operationId);
  assert.equal(op.status, "failed");
  assert.equal(op.error_code, "TX_DROPPED");
  assert.equal(await h.store.countMonthlyUsage(user.id), 0);
  assert.equal(h.storage.calls.delete, 0);

  // The user can now retry the same file.
  const retry = await post(h, token, "dropped");
  assert.equal(retry.status, 201);
});

test("definite broadcast rejection → failed, quota released, file removed (never sent)", async () => {
  const h = await createHarness();
  const { user, token } = await h.signUp();
  h.chain.fail.broadcast = Object.assign(new Error("insufficient funds"), { code: "INSUFFICIENT_FUNDS" });
  const res = await post(h, token, "rejected");
  assert.equal(res.status, 503);
  assert.equal(await h.store.countMonthlyUsage(user.id), 0);
  assert.equal(h.storage.objects.size, 0);
});

test("operation abandoned before broadcast (crash) is failed by the reconciler and the hash freed", async () => {
  const h = await createHarness();
  const { user, token } = await h.signUp();
  const hash = hashBuffer(fileBuffer("crashed"));
  const r = await h.store.reserveOperation({
    userId: user.id, documentHash: hash, monthlyLimit: 3, maxInFlight: 2, reservedCostWei: 1n,
    dailyBudgetWei: 10n ** 18n, storageKey: `documents/${hash}`, originalFilename: "c.txt", label: "", fileSizeBytes: 7, contentType: "text/plain",
  });
  await h.pg.age(r.operation.id, 11 * 60_000);
  await h.notarization.reconcileOnce();
  assert.equal((await h.store.getOperation(r.operation.id)).status, "failed");
  assert.equal((await post(h, token, "crashed")).status, 201);
  assert.equal(h.chain.calls.broadcast, 1);
});

test("a reverted tx is reported as failed", async () => {
  const h = await createHarness({ chainOptions: { autoMine: false } });
  const { token } = await h.signUp();
  const res = await post(h, token, "will revert");
  h.chain.seedRecord(res.body.documentHash, { submitter: "0x00000000000000000000000000000000000000bb" });
  h.chain.mine();
  const poll = await request(h.app).get(`/api/documents/operations/${res.body.operationId}`).set("Authorization", `Bearer ${token}`);
  assert.equal(poll.body.outcome, "failed");
  assert.equal(poll.body.errorCode, "TX_REVERTED");
});

test("at quota, a confirmed-but-unindexed record is still recoverable via the status endpoint (no re-upload)", async () => {
  const h = await createHarness();
  const { token } = await h.signUp("free");
  await post(h, token, "q1");
  await post(h, token, "q2");
  h.pg.faults.set("upsertDocument", 1);
  const third = await post(h, token, "q3");
  assert.equal(third.body.metadataStatus, "pending");

  // Re-uploading is refused by the quota preflight (the upload would be wasted)...
  assert.equal((await post(h, token, "q3")).status, 402);
  // ...but polling the operation finishes the indexing.
  const poll = await request(h.app).get(`/api/documents/operations/${third.body.operationId}`).set("Authorization", `Bearer ${token}`);
  assert.equal(poll.body.metadataStatus, "available");
  assert.ok(await h.store.getDocumentByHash(third.body.documentHash));
  assert.equal(h.chain.calls.broadcast, 3);
});
