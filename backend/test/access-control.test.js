import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createHarness, fileBuffer } from "./helpers/harness.js";
import { hashBuffer } from "../src/lib/contract.js";

async function notarizeAs(h, token, text, fields = {}) {
  let req = request(h.app).post("/api/documents/notarize").set("Authorization", `Bearer ${token}`);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach("file", fileBuffer(text), "secret-contract.pdf");
}

test("notarize requires a verified session", async () => {
  const h = await createHarness();
  const anon = await request(h.app).post("/api/documents/notarize").attach("file", fileBuffer("x"), "a.txt");
  assert.equal(anon.status, 401);
  const forged = await request(h.app)
    .post("/api/documents/notarize")
    .set("Authorization", "Bearer forged-token")
    .attach("file", fileBuffer("x"), "a.txt");
  assert.equal(forged.status, 401);
  assert.equal(h.storage.calls.put, 0);
  assert.equal(h.chain.calls.broadcast, 0);
});

test("download: anonymous 401, other user 404, owner gets a short-lived signed URL", async () => {
  const h = await createHarness();
  const alice = await h.signUp();
  const bob = await h.signUp();
  const res = await notarizeAs(h, alice.token, "alice's private file");
  assert.equal(res.status, 201);
  const hash = res.body.documentHash;

  assert.equal((await request(h.app).get(`/api/documents/${hash}/download`)).status, 401);

  const cross = await request(h.app).get(`/api/documents/${hash}/download`).set("Authorization", `Bearer ${bob.token}`);
  assert.equal(cross.status, 404);
  assert.equal(cross.body.url, undefined);

  const own = await request(h.app).get(`/api/documents/${hash}/download`).set("Authorization", `Bearer ${alice.token}`);
  assert.equal(own.status, 200);
  assert.match(own.body.url, /X-Amz-Expires=300/);
  assert.equal(own.headers["cache-control"], "no-store");
});

test("ownership comes from the verified token only — spoofed ids/addresses are ignored", async () => {
  const h = await createHarness();
  const alice = await h.signUp();
  const bob = await h.signUp();
  const hash = (await notarizeAs(h, alice.token, "spoof target")).body.documentHash;

  const res = await request(h.app)
    .get(`/api/documents/${hash}/download?userId=${alice.user.id}&submitter=${h.chain.relayerAddress}`)
    .set("Authorization", `Bearer ${bob.token}`)
    .set("X-User-Id", alice.user.id);
  assert.equal(res.status, 404);

  // A notarize request with a forged user_id field is still attributed to the token's user.
  const own = await notarizeAs(h, bob.token, "bob doc", { user_id: alice.user.id });
  const doc = await h.store.getDocumentByHash(own.body.documentHash);
  assert.equal(doc.user_id, bob.user.id);
});

test("legacy (pre-auth) documents are not assigned to anyone and cannot be downloaded", async () => {
  const h = await createHarness();
  const legacyHash = hashBuffer(fileBuffer("legacy upload"));
  await h.pg.db.query(
    `insert into documents (document_hash, label, submitter_address, tx_hash, block_timestamp, storage_key, is_legacy)
     values ($1, 'old-name.pdf', $2, '0xabc', 1, 'documents/legacy.pdf', true)`,
    [legacyHash, h.chain.relayerAddress]
  );
  h.chain.seedRecord(legacyHash, { label: "old-name.pdf" });

  const newcomer = await h.signUp("standard");
  const dl = await request(h.app).get(`/api/documents/${legacyHash}/download`).set("Authorization", `Bearer ${newcomer.token}`);
  assert.equal(dl.status, 404);

  const mine = await request(h.app).get("/api/documents/mine").set("Authorization", `Bearer ${newcomer.token}`);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.total, 0);

  const row = await h.store.getDocumentByHash(legacyHash);
  assert.equal(row.user_id, null);
});

test("public verification exposes no storage keys, private filenames or owners", async () => {
  const h = await createHarness();
  const alice = await h.signUp();
  const hash = (await notarizeAs(h, alice.token, "privacy check")).body.documentHash;

  const res = await request(h.app).get(`/api/documents/verify/${hash}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.verified, true);
  const text = JSON.stringify(res.body);
  for (const forbidden of ["storage_key", "documents/", "secret-contract.pdf", alice.user.id, "original_filename", "user_id"]) {
    assert.ok(!text.includes(forbidden), `public response contains ${forbidden}`);
  }
});

test("original filenames are NOT put on-chain unless the user opts into a label", async () => {
  const h = await createHarness();
  const alice = await h.signUp();
  const plain = await notarizeAs(h, alice.token, "no label please");
  assert.equal((await h.chain.verify(plain.body.documentHash)).label, "");
  const doc = await h.store.getDocumentByHash(plain.body.documentHash);
  assert.equal(doc.original_filename, "secret-contract.pdf"); // kept privately
  assert.equal(doc.label, "");

  const labelled = await notarizeAs(h, alice.token, "with label", { label: "Lease v2" });
  assert.equal((await h.chain.verify(labelled.body.documentHash)).label, "Lease v2");

  const bad = await notarizeAs(h, alice.token, "bad label", { label: "x".repeat(65) });
  assert.equal(bad.status, 400);
});

test("history dashboard is Standard-only and lists only the caller's documents", async () => {
  const h = await createHarness();
  const free = await h.signUp("free");
  const std = await h.signUp("standard");
  await notarizeAs(h, std.token, "std doc 1");
  await notarizeAs(h, free.token, "free doc 1");

  const denied = await request(h.app).get("/api/documents/mine").set("Authorization", `Bearer ${free.token}`);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "PLAN_REQUIRED");

  const ok = await request(h.app).get("/api/documents/mine?limit=500").set("Authorization", `Bearer ${std.token}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.total, 1);
  assert.equal(ok.body.limit, 50); // bounded
  assert.equal(ok.body.documents[0].originalFilename, "secret-contract.pdf");

  const badPage = await request(h.app).get("/api/documents/mine?offset=-1").set("Authorization", `Bearer ${std.token}`);
  assert.equal(badPage.status, 400);
});

test("operation status is owner-only", async () => {
  const h = await createHarness();
  const alice = await h.signUp();
  const bob = await h.signUp();
  const { operationId } = (await notarizeAs(h, alice.token, "op owner")).body;
  assert.equal((await request(h.app).get(`/api/documents/operations/${operationId}`).set("Authorization", `Bearer ${bob.token}`)).status, 404);
  const own = await request(h.app).get(`/api/documents/operations/${operationId}`).set("Authorization", `Bearer ${alice.token}`);
  assert.equal(own.status, 200);
  assert.equal(own.body.outcome, "confirmed");
});

test("internal errors are never exposed to clients", async () => {
  const h = await createHarness();
  h.chain.fail.verify = new Error(`connect ECONNREFUSED ${"https://rpc.example.test/v2/test-rpc-api-key"}`);
  const res = await request(h.app).get(`/api/documents/verify/0x${"ab".repeat(32)}`);
  assert.equal(res.status, 503);
  assert.ok(!JSON.stringify(res.body).includes("ECONNREFUSED"));
  assert.ok(!JSON.stringify(res.body).includes("test-rpc-api-key"));
  assert.equal(res.body.details, undefined);
});
