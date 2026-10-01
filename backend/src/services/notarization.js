import { hashBuffer, classifyBroadcastError, isAlreadyNotarizedError } from "../lib/contract.js";
import { keyForHash } from "../lib/r2.js";
import { HttpError } from "../lib/errors.js";

/** Internal status -> the four outcomes clients see. */
export const OUTCOME = Object.freeze({
  reserved: "pending",
  uploaded: "pending",
  broadcasting: "pending",
  submitted: "pending",
  confirmed: "confirmed",
  failed: "failed",
  uncertain: "uncertain",
});

/** Owner-facing view of an operation. Never includes storage keys. */
export function describeOperation(op) {
  const outcome = OUTCOME[op.status] ?? "uncertain";
  return {
    operationId: op.id,
    documentHash: op.document_hash,
    outcome,
    status: op.status,
    txHash: op.tx_hash ?? null,
    blockNumber: op.block_number ?? null,
    timestamp: op.block_timestamp ?? null,
    label: op.label ?? "",
    metadataStatus: outcome === "confirmed" ? (op.indexed ? "available" : "pending") : null,
    errorCode: outcome === "failed" ? op.error_code ?? null : null,
  };
}

// Multipart framing overhead allowed on top of the file size when pre-checking Content-Length.
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * Serializes relayer broadcasts: an in-process queue plus a Postgres lease row, so only one
 * process at a time picks a nonce, signs, persists and broadcasts. The lease is held only
 * for that short critical section — never while waiting for a receipt.
 */
export function createRelayerCoordinator({ store, holderId, ttlSeconds, waitMs, sleep = defaultSleep, now = Date.now }) {
  let queue = Promise.resolve();

  async function acquire() {
    const deadline = now() + waitMs;
    for (;;) {
      if (await store.acquireRelayerLease(holderId, ttlSeconds)) return;
      if (now() >= deadline) {
        throw new HttpError(503, "RELAYER_BUSY", "The notarization service is busy. Please try again in a moment.");
      }
      await sleep(250);
    }
  }

  return {
    run(fn) {
      const result = queue.then(async () => {
        await acquire();
        try {
          return await fn();
        } finally {
          await store.releaseRelayerLease(holderId).catch(() => {});
        }
      });
      queue = result.catch(() => {});
      return result;
    },
  };
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function createNotarizationService({ store, chain, storage, config, log, relayer, now = () => Date.now() }) {
  const unavailable = (code = "SERVICE_UNAVAILABLE") =>
    new HttpError(503, code, "Notarization is temporarily unavailable. Please try again shortly.");

  async function db(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof HttpError) throw err;
      log.error("[notarize] database call failed", err);
      throw unavailable("METADATA_UNAVAILABLE");
    }
  }

  /** Update, but if the database is down keep going with the in-memory state; the reconciler catches up. */
  async function softUpdate(op, patch) {
    try {
      return (await store.updateOperation(op.id, patch)) ?? { ...op, ...patch };
    } catch (err) {
      log.warn(`[notarize] could not persist ${JSON.stringify(Object.keys(patch))} for operation ${op.id}`, err);
      return { ...op, ...patch };
    }
  }

  /** Delete an object we uploaded ONLY when this attempt definitively never reached the chain. */
  async function cleanupStorage(op) {
    if (!op.object_created || !op.storage_key) return;
    try {
      const [doc, active] = await Promise.all([
        store.getDocumentByHash(op.document_hash),
        store.getActiveOperationByHash(op.document_hash),
      ]);
      if (doc || active) return;
      await storage.delete(op.storage_key);
    } catch (err) {
      log.warn(`[notarize] storage cleanup skipped for operation ${op.id}`, err);
    }
  }

  /**
   * Mark failed. `neverBroadcast` must only be true when no transaction for this attempt
   * was ever signed — that is the only case where stored files are removed.
   */
  async function markFailed(op, code, { neverBroadcast = false, extra = {} } = {}) {
    const failed = await softUpdate(op, { status: "failed", error_code: code, ...extra });
    if (neverBroadcast) await cleanupStorage(failed);
    return failed;
  }

  async function applyReceipt(op, receipt) {
    if (receipt.status !== "success") {
      return markFailed(op, "TX_REVERTED", { extra: { tx_hash: receipt.txHash, actual_cost_wei: receipt.costWei } });
    }
    let blockTimestamp = op.block_timestamp ?? null;
    try {
      blockTimestamp = await chain.getBlockTimestamp(receipt.blockNumber);
    } catch (err) {
      log.warn(`[notarize] block timestamp lookup failed for operation ${op.id}`, err);
    }
    const confirmed = await softUpdate(op, {
      status: "confirmed",
      tx_hash: receipt.txHash,
      block_number: receipt.blockNumber,
      block_timestamp: blockTimestamp,
      actual_cost_wei: receipt.costWei,
      confirmed_at: new Date(now()).toISOString(),
    });
    return indexOperation(confirmed);
  }

  /** Write the documents row for a confirmed operation (idempotent upsert). */
  async function indexOperation(op) {
    if (op.status !== "confirmed" || op.indexed) return op;
    try {
      if (op.block_timestamp == null) {
        op = await softUpdate(op, { block_timestamp: await chain.getBlockTimestamp(op.block_number) });
      }
      await store.upsertDocument({
        document_hash: op.document_hash,
        label: op.label ?? "",
        original_filename: op.original_filename,
        submitter_address: op.submitter_address ?? chain.relayerAddress,
        tx_hash: op.tx_hash,
        block_timestamp: op.block_timestamp,
        storage_key: op.storage_key,
        file_size_bytes: op.file_size_bytes,
        content_type: op.content_type,
        user_id: op.user_id,
        operation_id: op.id,
        is_legacy: false,
      });
    } catch (err) {
      log.warn(`[notarize] indexing deferred for operation ${op.id}`, err);
      return op;
    }
    return softUpdate(op, { indexed: true });
  }

  /** Resolve an operation whose transaction may or may not have landed. */
  async function checkTransaction(op, { stale }) {
    if (op.tx_hash) {
      const receipt = await chain.getReceipt(op.tx_hash);
      if (receipt) return applyReceipt(op, receipt);
      if (await chain.isKnownTransaction(op.tx_hash)) {
        return op.status === "submitted" ? op : softUpdate(op, { status: "submitted" });
      }
    }

    const onChain = await chain.verify(op.document_hash);
    if (onChain.exists) {
      if (onChain.submitter !== chain.relayerAddress) {
        return markFailed(op, "NOTARIZED_ELSEWHERE");
      }
      const found = await chain.findNotarizationTx(op.document_hash);
      if (found?.status === "success") return applyReceipt(op, found);
    } else if (op.tx_nonce != null && (await chain.getLatestNonce()) > Number(op.tx_nonce)) {
      // Our nonce was consumed by a different transaction and ours has no receipt: it can never mine.
      return markFailed(op, "TX_DROPPED");
    }

    if (op.status === "broadcasting" && !stale) return op; // another request is mid-broadcast
    return op.status === "uncertain" ? op : softUpdate(op, { status: "uncertain", error_code: "TX_NOT_FOUND" });
  }

  /** One reconciliation step for an operation. Safe to run concurrently / repeatedly. */
  async function advance(op, { stale = false } = {}) {
    switch (op.status) {
      case "reserved":
      case "uploaded":
        // No transaction has been signed in these states, so abandoning them is safe.
        if (!stale) return op;
        return markFailed(op, "ABANDONED_BEFORE_BROADCAST", { neverBroadcast: true });
      case "broadcasting":
      case "submitted":
      case "uncertain":
        return checkTransaction(op, { stale });
      case "confirmed":
        return op.indexed ? op : indexOperation(op);
      default:
        return op;
    }
  }

  function isStale(op) {
    return now() - new Date(op.updated_at).getTime() > config.reconcile.staleAfterMs;
  }

  async function resumeExisting(op, user) {
    if (op.user_id !== user.id) {
      throw new HttpError(409, "ALREADY_NOTARIZED", "This document is already notarized (or being notarized).", {
        documentHash: op.document_hash,
      });
    }
    try {
      return await advance(op, { stale: isStale(op) });
    } catch (err) {
      log.warn(`[notarize] could not advance existing operation ${op.id}`, err);
      return op;
    }
  }

  /** Cheap checks that run BEFORE the request body is accepted. */
  async function preflight(user, entitlements, contentLength) {
    if (Number.isFinite(contentLength) && contentLength > entitlements.maxFileSizeBytes + MULTIPART_OVERHEAD_BYTES) {
      throw fileTooLarge(entitlements);
    }
    const used = await db(() => store.countMonthlyUsage(user.id, new Date(now())));
    if (used >= entitlements.monthlyNotarizations) throw quotaExceeded(entitlements, used);
    return { used };
  }

  async function notarize({ user, entitlements, file, label }) {
    const documentHash = hashBuffer(file.buffer);

    const existing = await db(() => store.getActiveOperationByHash(documentHash));
    if (existing) return resumeExisting(existing, user);

    let onChain;
    try {
      onChain = await chain.verify(documentHash);
    } catch (err) {
      log.error("[notarize] chain read failed", err);
      throw unavailable("CHAIN_UNAVAILABLE");
    }
    if (onChain.exists) {
      throw new HttpError(409, "ALREADY_NOTARIZED", "This document is already notarized.", { documentHash });
    }

    // Authoritative, cross-instance checks: duplicate, monthly quota, in-flight cap, daily spend.
    const reservation = await db(() =>
      store.reserveOperation({
        userId: user.id,
        documentHash,
        monthlyLimit: entitlements.monthlyNotarizations,
        maxInFlight: config.relayer.maxInFlightPerUser,
        reservedCostWei: config.relayer.maxTxCostWei,
        dailyBudgetWei: config.relayer.dailyBudgetWei,
        storageKey: keyForHash(documentHash),
        originalFilename: file.originalFilename,
        label,
        fileSizeBytes: file.size,
        contentType: file.contentType,
      })
    );
    if (!reservation.ok) {
      switch (reservation.reason) {
        case "duplicate":
          return resumeExisting(reservation.operation, user);
        case "quota":
          throw quotaExceeded(entitlements, reservation.used);
        case "in_flight":
          throw new HttpError(429, "TOO_MANY_IN_FLIGHT", "You already have notarizations in progress. Wait for them to finish.");
        case "budget":
          throw new HttpError(503, "RELAYER_BUDGET_EXHAUSTED", "Daily notarization capacity has been reached. Please try again tomorrow.");
        default:
          throw unavailable();
      }
    }
    let op = reservation.operation;

    // 1. Store the original privately (content-addressed: identical bytes => identical key).
    try {
      let created = false;
      if (!(await storage.exists(op.storage_key))) {
        await storage.put(op.storage_key, file.buffer, file.contentType);
        created = true;
      }
      op = await store.updateOperation(op.id, { status: "uploaded", object_created: created });
    } catch (err) {
      log.error(`[notarize] storage step failed for operation ${op.id}`, err);
      await markFailed(op, "STORAGE_FAILED", { neverBroadcast: true });
      throw new HttpError(502, "STORAGE_UNAVAILABLE", "File storage is temporarily unavailable. Please try again.");
    }

    // 2. Estimate and enforce the per-transaction spending cap before signing anything.
    let estimate;
    try {
      estimate = await chain.estimateNotarize(documentHash, op.label);
    } catch (err) {
      if (isAlreadyNotarizedError(err)) {
        await markFailed(op, "ALREADY_NOTARIZED", { neverBroadcast: true });
        throw new HttpError(409, "ALREADY_NOTARIZED", "This document is already notarized.", { documentHash });
      }
      log.error(`[notarize] gas estimation failed for operation ${op.id}`, err);
      await markFailed(op, "ESTIMATE_FAILED", { neverBroadcast: true });
      throw unavailable("CHAIN_UNAVAILABLE");
    }
    if (estimate.costWei > config.relayer.maxTxCostWei) {
      await markFailed(op, "RELAYER_TX_COST_LIMIT", { neverBroadcast: true });
      throw new HttpError(503, "RELAYER_COST_LIMIT", "Network fees are unusually high right now. Please try again later.");
    }

    // 3. Sign, persist the tx hash, then broadcast — one relayer at a time.
    op = await relayer.run(async () => {
      const nonce = await chain.getPendingNonce();
      const { txHash, rawTx } = await chain.signNotarize(documentHash, op.label, { ...estimate, nonce });
      // If this write fails we have NOT broadcast, so the attempt is safely abandonable.
      const persisted = await db(() =>
        store.updateOperation(op.id, {
          status: "broadcasting",
          tx_hash: txHash,
          tx_nonce: nonce,
          submitter_address: chain.relayerAddress,
          reserved_cost_wei: estimate.costWei,
          attempts: (op.attempts ?? 0) + 1,
        })
      );
      try {
        await chain.broadcast(rawTx);
      } catch (err) {
        const outcome = classifyBroadcastError(err);
        log.warn(`[notarize] broadcast ${outcome} for operation ${op.id}`, err);
        return outcome === "failed"
          ? markFailed(persisted, "BROADCAST_REJECTED", { neverBroadcast: true })
          : softUpdate(persisted, { status: "uncertain", error_code: "BROADCAST_UNCONFIRMED" });
      }
      return softUpdate(persisted, { status: "submitted" });
    });

    if (op.status === "failed") throw unavailable("RELAYER_REJECTED");

    // 4. Wait (bounded) for the receipt. A timeout leaves it pending for the reconciler.
    if (op.status === "submitted") {
      try {
        const receipt = await chain.waitForReceipt(op.tx_hash, config.chain.receiptTimeoutMs);
        if (receipt) op = await applyReceipt(op, receipt);
      } catch (err) {
        log.warn(`[notarize] receipt wait failed for operation ${op.id}`, err);
      }
    }
    return op;
  }

  /** Background pass over operations needing attention. Returns how many were examined. */
  async function reconcileOnce({ minAgeMs = 30_000, limit = 50 } = {}) {
    const ops = await store.listOperationsNeedingReconcile({ updatedBefore: new Date(now() - minAgeMs), limit });
    for (const op of ops) {
      try {
        await advance(op, { stale: isStale(op) });
      } catch (err) {
        log.warn(`[reconcile] operation ${op.id} still unresolved`, err);
      }
    }
    return ops.length;
  }

  return { preflight, notarize, advance, reconcileOnce, describe: describeOperation };
}

export function fileTooLarge(entitlements) {
  return new HttpError(
    413,
    "FILE_TOO_LARGE",
    `File exceeds your plan's ${Math.round(entitlements.maxFileSizeBytes / (1024 * 1024))} MB limit.`,
    { maxFileSizeBytes: entitlements.maxFileSizeBytes, plan: entitlements.plan }
  );
}

export function quotaExceeded(entitlements, used) {
  return new HttpError(
    402,
    "QUOTA_EXCEEDED",
    `You've used all ${entitlements.monthlyNotarizations} notarizations included in your ${entitlements.plan} plan this month.`,
    { used, limit: entitlements.monthlyNotarizations, plan: entitlements.plan }
  );
}
