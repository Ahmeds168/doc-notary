import { createClient } from "@supabase/supabase-js";

/** Service-role client — backend-only, never expose this key to the frontend. */
export function createSupabaseClient(config) {
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function unwrap({ data, error }) {
  if (error) throw Object.assign(new Error(error.message), { code: error.code, name: "SupabaseError" });
  return data;
}

export function startOfUtcMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const RECONCILE_STATUSES = ["reserved", "uploaded", "broadcasting", "submitted", "uncertain"];

/**
 * Data-access layer over Supabase. Everything that touches Postgres goes through here so
 * tests can swap in an in-memory implementation with the same contract.
 */
export function createStore(supabase) {
  return {
    async getProfile(userId) {
      return unwrap(await supabase.from("profiles").select("id, plan, plan_source").eq("id", userId).maybeSingle());
    },

    /**
     * Plan update path. Today it's used by scripts/set-plan.js (manual/admin); the Kelviq
     * sync (webhook or entitlement poll) should call this with source = "kelviq".
     */
    async setUserPlan(userId, plan, source, billingCustomerId) {
      const patch = { plan, plan_source: source, plan_updated_at: new Date().toISOString() };
      if (billingCustomerId !== undefined) patch.billing_customer_id = billingCustomerId;
      return unwrap(
        await supabase.from("profiles").upsert({ id: userId, ...patch }, { onConflict: "id" }).select().single()
      );
    },

    /** Non-failed operations created since the start of the current UTC month. */
    async countMonthlyUsage(userId, now = new Date()) {
      const { count, error } = await supabase
        .from("notarization_operations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .neq("status", "failed")
        .gte("created_at", startOfUtcMonth(now).toISOString());
      if (error) throw Object.assign(new Error(error.message), { code: error.code, name: "SupabaseError" });
      return count ?? 0;
    },

    /** Atomic duplicate/quota/in-flight/budget check + insert. See reserve_notarization(). */
    async reserveOperation(p) {
      return unwrap(
        await supabase.rpc("reserve_notarization", {
          p_user_id: p.userId,
          p_document_hash: p.documentHash,
          p_monthly_limit: p.monthlyLimit,
          p_max_in_flight: p.maxInFlight,
          p_reserved_cost_wei: p.reservedCostWei.toString(),
          p_daily_budget_wei: p.dailyBudgetWei.toString(),
          p_storage_key: p.storageKey,
          p_original_filename: p.originalFilename,
          p_label: p.label,
          p_file_size_bytes: p.fileSizeBytes,
          p_content_type: p.contentType,
        })
      );
    },

    async getActiveOperationByHash(documentHash) {
      return unwrap(
        await supabase
          .from("notarization_operations")
          .select("*")
          .eq("document_hash", documentHash)
          .neq("status", "failed")
          .maybeSingle()
      );
    },

    async getOperation(id) {
      return unwrap(await supabase.from("notarization_operations").select("*").eq("id", id).maybeSingle());
    },

    async updateOperation(id, patch) {
      const row = { ...patch, updated_at: new Date().toISOString() };
      for (const k of ["actual_cost_wei", "reserved_cost_wei"]) if (typeof row[k] === "bigint") row[k] = row[k].toString();
      return unwrap(await supabase.from("notarization_operations").update(row).eq("id", id).select().single());
    },

    /** Operations that may need the reconciler: in-flight ones, and confirmed-but-unindexed. */
    async listOperationsNeedingReconcile({ updatedBefore, limit = 50 }) {
      return unwrap(
        await supabase
          .from("notarization_operations")
          .select("*")
          .or(`status.in.(${RECONCILE_STATUSES.join(",")}),and(status.eq.confirmed,indexed.eq.false)`)
          .lt("updated_at", updatedBefore.toISOString())
          .order("updated_at", { ascending: true })
          .limit(limit)
      );
    },

    async getDocumentByHash(documentHash) {
      return unwrap(await supabase.from("documents").select("*").eq("document_hash", documentHash).maybeSingle());
    },

    /** Idempotent: re-indexing the same confirmed operation is a no-op update. */
    async upsertDocument(row) {
      return unwrap(await supabase.from("documents").upsert(row, { onConflict: "document_hash" }).select().single());
    },

    async listDocumentsForUser(userId, { limit, offset }) {
      const { data, error, count } = await supabase
        .from("documents")
        .select("document_hash, label, original_filename, tx_hash, block_timestamp, file_size_bytes, content_type, created_at", {
          count: "exact",
        })
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw Object.assign(new Error(error.message), { code: error.code, name: "SupabaseError" });
      return { documents: data, total: count ?? 0 };
    },

    async acquireRelayerLease(holder, ttlSeconds) {
      return unwrap(await supabase.rpc("acquire_relayer_lease", { p_holder: holder, p_ttl_seconds: ttlSeconds }));
    },

    async releaseRelayerLease(holder) {
      unwrap(await supabase.rpc("release_relayer_lease", { p_holder: holder }));
    },
  };
}
