import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createHarness, fileBuffer } from "./helpers/harness.js";
import { hashBuffer } from "../src/lib/contract.js";

test("Supabase outage: verification still returns the on-chain proof with metadataStatus=unavailable", async () => {
  const h = await createHarness();
  const { token } = await h.signUp();
  const res = await request(h.app).post("/api/documents/notarize").set("Authorization", `Bearer ${token}`).attach("file", fileBuffer("outage"), "o.txt");
  const hash = res.body.documentHash;

  h.pg.faults.set("*", Infinity); // the whole metadata service is down (e.g. paused project)
  const v = await request(h.app).get(`/api/documents/verify/${hash}`);
  assert.equal(v.status, 200);
  assert.equal(v.body.verified, true);
  assert.equal(v.body.metadataStatus, "unavailable");
  assert.equal(v.body.metadata, null);
  assert.ok(v.body.onChain.timestamp > 0);

  // Stats come from the chain too.
  assert.equal((await request(h.app).get("/api/stats")).status, 200);
});

test("hung metadata service: verification times out the lookup instead of hanging", async () => {
  const h = await createHarness();
  const hash = hashBuffer(fileBuffer("hang"));
  h.chain.seedRecord(hash);
  h.store.getDocumentByHash = () => new Promise(() => {}); // never resolves
  const started = Date.now();
  const v = await request(h.app).get(`/api/documents/verify/${hash}`);
  assert.equal(v.body.metadataStatus, "unavailable");
  assert.equal(v.body.verified, true);
  assert.ok(Date.now() - started < 2000);
});

test("on-chain but not indexed → metadataStatus=not_indexed; not on chain → verified=false", async () => {
  const h = await createHarness();
  const hash = hashBuffer(fileBuffer("unindexed"));
  h.chain.seedRecord(hash);
  const v = await request(h.app).get(`/api/documents/verify/${hash}`);
  assert.equal(v.body.metadataStatus, "not_indexed");

  const missing = await request(h.app).get(`/api/documents/verify/0x${"cd".repeat(32)}`);
  assert.equal(missing.body.verified, false);
  assert.equal(missing.body.metadataStatus, "not_applicable");
});

test("hash input is normalized (case, missing 0x) before lookups, and garbage rejected", async () => {
  const h = await createHarness();
  const hash = hashBuffer(fileBuffer("normalize"));
  h.chain.seedRecord(hash);
  for (const variant of [hash.toUpperCase().replace("0X", "0x"), hash.slice(2), hash.slice(2).toUpperCase()]) {
    const v = await request(h.app).get(`/api/documents/verify/${variant}`);
    assert.equal(v.status, 200, variant);
    assert.equal(v.body.documentHash, hash);
    assert.equal(v.body.verified, true);
  }
  for (const bad of ["0x123", "zz".repeat(32), "0x" + "a".repeat(65)]) {
    assert.equal((await request(h.app).get(`/api/documents/verify/${bad}`)).status, 400, bad);
  }
});

test("the old file-upload verify endpoint and public listing are gone", async () => {
  const h = await createHarness();
  const up = await request(h.app).post("/api/documents/verify").attach("file", fileBuffer("x"), "x.txt");
  assert.equal(up.status, 404);
  const list = await request(h.app).get("/api/documents");
  assert.equal(list.status, 404);
});
