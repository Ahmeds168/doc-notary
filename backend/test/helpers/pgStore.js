import { createMigratedDb } from "./pglite.js";
import { startOfUtcMonth } from "../../src/lib/supabase.js";

/**
 * Store implementation over an in-memory Postgres (PGlite) with the REAL schema.sql +
 * migrations applied, so quota / duplicate / budget logic under test is the actual SQL.
 * Mirrors the contract of src/lib/supabase.js#createStore.
 *
 * `faults` lets tests simulate a Supabase outage per method: faults.set("upsertDocument", n)
 * fails the next n calls (Infinity = down until cleared).
 */
export async function createPgStore() {
  const db = await createMigratedDb();
  const faults = new Map();
  const calls = [];

  const guard = (name, fn) => async (...args) => {
    calls.push(name);
    const remaining = faults.get(name) ?? faults.get("*") ?? 0;
    if (remaining > 0) {
      if (faults.has(name)) faults.set(name, remaining - 1);
      throw Object.assign(new Error(`simulated outage in ${name}`), { name: "SupabaseError" });
    }
    return fn(...args);
  };

  const one = async (sql, params) => (await db.query(sql, params)).rows[0] ?? null;
  const normalizeOp = (row) => row && { ...row, reserved_cost_wei: row.reserved_cost_wei?.toString(), actual_cost_wei: row.actual_cost_wei?.toString() ?? null };

  const store = {
    getProfile: guard("getProfile", (userId) => one("select id, plan, plan_source from profiles where id = $1", [userId])),

    setUserPlan: guard("setUserPlan", (userId, plan, source) =>
      one(
        `insert into profiles (id, plan, plan_source) values ($1, $2, $3)
         on conflict (id) do update set plan = excluded.plan, plan_source = excluded.plan_source, plan_updated_at = now()
         returning *`,
        [userId, plan, source]
      )
    ),

    countMonthlyUsage: guard("countMonthlyUsage", async (userId, now = new Date()) => {
      const row = await one(
        "select count(*)::int as n from notarization_operations where user_id = $1 and status <> 'failed' and created_at >= $2",
        [userId, startOfUtcMonth(now).toISOString()]
      );
      return row.n;
    }),

    reserveOperation: guard("reserveOperation", async (p) => {
      const row = await one(
        "select public.reserve_notarization($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as r",
        [
          p.userId, p.documentHash, p.monthlyLimit, p.maxInFlight, p.reservedCostWei.toString(),
          p.dailyBudgetWei.toString(), p.storageKey, p.originalFilename, p.label, p.fileSizeBytes, p.contentType,
        ]
      );
      return row.r;
    }),

    getActiveOperationByHash: guard("getActiveOperationByHash", async (hash) =>
      normalizeOp(await one("select * from notarization_operations where document_hash = $1 and status <> 'failed'", [hash]))
    ),

    getOperation: guard("getOperation", async (id) =>
      normalizeOp(await one("select * from notarization_operations where id = $1", [id]))
    ),

    updateOperation: guard("updateOperation", async (id, patch) => {
      const entries = Object.entries({ ...patch, updated_at: new Date().toISOString() }).map(([k, v]) => [
        k,
        typeof v === "bigint" ? v.toString() : v,
      ]);
      const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(", ");
      return normalizeOp(
        await one(`update notarization_operations set ${sets} where id = $1 returning *`, [id, ...entries.map(([, v]) => v)])
      );
    }),

    listOperationsNeedingReconcile: guard("listOperationsNeedingReconcile", async ({ updatedBefore, limit = 50 }) =>
      (
        await db.query(
          `select * from notarization_operations
            where (status in ('reserved','uploaded','broadcasting','submitted','uncertain') or (status = 'confirmed' and not indexed))
              and updated_at < $1 order by updated_at limit $2`,
          [updatedBefore.toISOString(), limit]
        )
      ).rows.map(normalizeOp)
    ),

    getDocumentByHash: guard("getDocumentByHash", (hash) => one("select * from documents where document_hash = $1", [hash])),

    upsertDocument: guard("upsertDocument", (row) => {
      const cols = Object.keys(row);
      return one(
        `insert into documents (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})
         on conflict (document_hash) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}
         returning *`,
        cols.map((c) => row[c])
      );
    }),

    listDocumentsForUser: guard("listDocumentsForUser", async (userId, { limit, offset }) => {
      const rows = (
        await db.query("select * from documents where user_id = $1 order by created_at desc limit $2 offset $3", [userId, limit, offset])
      ).rows;
      const total = (await one("select count(*)::int as n from documents where user_id = $1", [userId])).n;
      return { documents: rows, total };
    }),

    acquireRelayerLease: guard("acquireRelayerLease", async (holder, ttl) =>
      (await one("select public.acquire_relayer_lease($1, $2) as ok", [holder, ttl])).ok
    ),

    releaseRelayerLease: guard("releaseRelayerLease", async (holder) => {
      await db.query("select public.release_relayer_lease($1)", [holder]);
    }),
  };

  async function createUser(email = `user-${Math.random().toString(36).slice(2)}@example.com`, plan = "free") {
    const { id } = await one("insert into auth.users (email) values ($1) returning id", [email]);
    if (plan !== "free") await db.query("update profiles set plan = $2 where id = $1", [id, plan]);
    return { id, email };
  }

  /** Push an operation's updated_at into the past so the reconciler considers it stale. */
  async function age(opId, ms) {
    await db.query("update notarization_operations set updated_at = now() - make_interval(secs => $2) where id = $1", [opId, ms / 1000]);
  }

  return { store, db, faults, calls, createUser, age };
}
