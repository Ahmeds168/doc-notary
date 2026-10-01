import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMigratedDb } from "./helpers/pglite.js";

const reserve = (db, user, hash, { limit = 3, inFlight = 2, cost = "10", budget = "100" } = {}) =>
  db.query("select public.reserve_notarization($1,$2,$3,$4,$5,$6,'k',null,'',1,null) as r", [user, hash, limit, inFlight, cost, budget]).then((r) => r.rows[0].r);

const h = (n) => `0x${n.toString(16).padStart(64, "0")}`;

test("migration leaves pre-existing documents unowned and flagged legacy", async () => {
  const db = await createMigratedDb({
    beforeMigrations: (db) =>
      db.exec(`insert into documents (document_hash, label, submitter_address, tx_hash, block_timestamp, storage_key)
               values ('0xAB${"0".repeat(62)}', 'invoice.pdf', '0xRELAYER', '0x1', 1, 'documents/x.pdf')`),
  });
  await db.query("insert into auth.users (email) values ('first-user@example.com')");
  const rows = (await db.query("select user_id, is_legacy, document_hash, submitter_address from documents")).rows;
  assert.deepEqual(rows, [{ user_id: null, is_legacy: true, document_hash: `0xab${"0".repeat(62)}`, submitter_address: "0xrelayer" }]);
});

test("migration is idempotent", async () => {
  const db = await createMigratedDb();
  const sql = await readFile(new URL("../supabase/migrations/001_auth_ownership_operations.sql", import.meta.url), "utf8");
  await db.exec(sql);
  await db.exec(sql);
});

test("new auth users get a free profile; public read policy on documents is removed", async () => {
  const db = await createMigratedDb();
  await db.query("insert into auth.users (email) values ('a@example.com')");
  assert.equal((await db.query("select plan from profiles")).rows[0].plan, "free");
  const policies = (await db.query("select policyname from pg_policies where tablename = 'documents'")).rows.map((r) => r.policyname);
  assert.ok(!policies.includes("Public can read documents"));
  assert.ok(policies.includes("Owners can read own documents"));
});

test("reserve_notarization: duplicate, quota, in-flight and budget rules", async () => {
  const db = await createMigratedDb();
  const user = (await db.query("insert into auth.users (email) values ('q@example.com') returning id")).rows[0].id;

  assert.equal((await reserve(db, user, h(1))).ok, true);
  assert.equal((await reserve(db, user, h(1))).reason, "duplicate");
  assert.equal((await reserve(db, user, h(2))).ok, true);
  assert.equal((await reserve(db, user, h(3))).reason, "in_flight");

  await db.query("update notarization_operations set status = 'confirmed'");
  assert.equal((await reserve(db, user, h(3))).ok, true);
  await db.query("update notarization_operations set status = 'confirmed'");
  assert.equal((await reserve(db, user, h(4))).reason, "quota");

  // Failed attempts free both quota and the hash.
  await db.query(`update notarization_operations set status = 'failed' where document_hash = '${h(3)}'`);
  assert.equal((await reserve(db, user, h(3))).ok, true);

  const other = (await db.query("insert into auth.users (email) values ('b@example.com') returning id")).rows[0].id;
  // Spend so far today: 4 ops * reserved 10 (one failed => 0) = 30; budget 35 => next (10) refused.
  assert.equal((await reserve(db, other, h(9), { budget: "35" })).reason, "budget");
});

test("reverted transactions still count against the relayer budget", async () => {
  const db = await createMigratedDb();
  const user = (await db.query("insert into auth.users (email) values ('r@example.com') returning id")).rows[0].id;
  await reserve(db, user, h(1));
  await db.query("update notarization_operations set status = 'failed', actual_cost_wei = 50");
  assert.equal((await reserve(db, user, h(2), { budget: "55" })).reason, "budget");
});

test("hash format is enforced in the database", async () => {
  const db = await createMigratedDb();
  const user = (await db.query("insert into auth.users (email) values ('c@example.com') returning id")).rows[0].id;
  await assert.rejects(reserve(db, user, "0xABC"));
});
