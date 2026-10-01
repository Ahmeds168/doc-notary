import { Router } from "express";
import { planSizedUpload } from "../middleware/upload.js";
import { requireAuth } from "../lib/auth.js";
import { rateLimit } from "../lib/rateLimit.js";
import { HttpError } from "../lib/errors.js";
import { normalizeHash, parseLabel, parsePagination, sanitizeFilename } from "../lib/validation.js";
import { describeOperation } from "../services/notarization.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("metadata timeout"), { code: "TIMEOUT" })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Only fields that are already public on-chain (or harmless) — never storage keys, filenames or owners. */
function publicMetadata(doc) {
  return { txHash: doc.tx_hash, blockTimestamp: Number(doc.block_timestamp) };
}

export function createDocumentsRouter({ config, store, chain, storage, auth, entitlements, notarization, log }) {
  const router = Router();
  const authed = requireAuth(auth, log);

  const ipKey = (req) => `ip:${req.ip}`;
  const verifyLimiter = rateLimit({ limit: config.rateLimit.verifyPerMinute, keyFn: ipKey });
  const notarizeIpLimiter = rateLimit({ limit: config.rateLimit.notarizePerMinute * 4, keyFn: ipKey });
  const notarizeUserLimiter = rateLimit({ limit: config.rateLimit.notarizePerMinute, keyFn: (req) => `user:${req.user.id}` });

  const loadEntitlements = async (req, _res, next) => {
    try {
      req.entitlements = await entitlements.getEntitlements(req.user.id);
      next();
    } catch (err) {
      log.error("[entitlements] lookup failed", err);
      next(new HttpError(503, "ENTITLEMENTS_UNAVAILABLE", "Couldn't load your plan. Please try again shortly."));
    }
  };

  // Quota + declared size are checked here, before multer reads the body into memory.
  const preflight = async (req, _res, next) => {
    try {
      await notarization.preflight(req.user, req.entitlements, Number(req.get("content-length")));
      next();
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/documents/notarize   (auth required)
   * multipart: file (required), label (optional — published on-chain, empty by default).
   * 201 confirmed | 202 pending/uncertain (poll /operations/:id) | 4xx/5xx with { error, code }.
   * Retrying the same file is idempotent: it resumes the existing operation, never sends a second tx.
   */
  router.post(
    "/notarize",
    notarizeIpLimiter,
    authed,
    notarizeUserLimiter,
    loadEntitlements,
    preflight,
    planSizedUpload("file"),
    async (req, res, next) => {
      try {
        if (!req.file) throw new HttpError(400, "NO_FILE", "No file provided. Use multipart field 'file'.");
        const label = parseLabel(req.body?.label);
        if (!label.ok) throw new HttpError(400, "INVALID_LABEL", "Label must be at most 64 printable characters.");

        const op = await notarization.notarize({
          user: req.user,
          entitlements: req.entitlements,
          label: label.value,
          file: {
            buffer: req.file.buffer,
            size: req.file.size,
            contentType: MIME_RE.test(req.file.mimetype || "") ? req.file.mimetype.slice(0, 255) : "application/octet-stream",
            originalFilename: sanitizeFilename(req.file.originalname),
          },
        });

        const body = describeOperation(op);
        if (body.outcome === "failed") {
          return res.status(502).json({ error: "The notarization transaction failed.", code: "TX_FAILED", ...body });
        }
        res.status(body.outcome === "confirmed" ? 201 : 202).json(body);
      } catch (err) {
        next(err);
      }
    }
  );

  /** GET /api/documents/operations/:id — owner-only status polling for pending/uncertain operations. */
  router.get("/operations/:id", authed, async (req, res, next) => {
    try {
      if (!UUID_RE.test(req.params.id)) throw new HttpError(400, "INVALID_ID", "Invalid operation id.");
      let op = await store.getOperation(req.params.id).catch((err) => {
        log.error("[operations] lookup failed", err);
        throw new HttpError(503, "METADATA_UNAVAILABLE", "Status is temporarily unavailable.");
      });
      if (!op || op.user_id !== req.user.id) throw new HttpError(404, "NOT_FOUND", "Operation not found.");
      if (op.status !== "failed" && !(op.status === "confirmed" && op.indexed)) {
        op = await notarization.advance(op).catch(() => op);
      }
      res.json(describeOperation(op));
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/documents/verify/:hash — public, unlimited by plan (rate-limited per IP for abuse only).
   * The chain is the source of truth; Supabase metadata is optional enrichment and its outage
   * never turns a valid proof into an error.
   */
  router.get("/verify/:hash", verifyLimiter, async (req, res, next) => {
    try {
      const documentHash = normalizeHash(req.params.hash);
      if (!documentHash) {
        throw new HttpError(400, "INVALID_HASH", "Invalid hash. Expected a 32-byte SHA-256 hex string.");
      }

      let onChain;
      try {
        onChain = await chain.verify(documentHash);
      } catch (err) {
        log.error("[verify] chain read failed", err);
        throw new HttpError(503, "CHAIN_UNAVAILABLE", "The blockchain node is unreachable. Please try again shortly.");
      }

      let metadata = null;
      let metadataStatus = "not_applicable";
      if (onChain.exists) {
        try {
          const doc = await withTimeout(store.getDocumentByHash(documentHash), config.supabase.metadataTimeoutMs);
          metadata = doc ? publicMetadata(doc) : null;
          metadataStatus = doc ? "available" : "not_indexed";
        } catch (err) {
          log.warn("[verify] metadata unavailable", err);
          metadataStatus = "unavailable";
        }
      }

      res.json({
        documentHash,
        verified: onChain.exists,
        onChain: onChain.exists ? onChain : { exists: false },
        metadata,
        metadataStatus,
      });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/documents/mine — the caller's own history (plans with the history dashboard). */
  router.get("/mine", authed, loadEntitlements, async (req, res, next) => {
    try {
      if (!req.entitlements.historyDashboard) {
        throw new HttpError(403, "PLAN_REQUIRED", "The history dashboard is part of the Standard plan.", {
          plan: req.entitlements.plan,
        });
      }
      const page = parsePagination(req.query);
      if (!page) throw new HttpError(400, "INVALID_PAGINATION", "limit and offset must be non-negative integers.");

      const { documents, total } = await store.listDocumentsForUser(req.user.id, page).catch((err) => {
        log.error("[mine] listing failed", err);
        throw new HttpError(503, "METADATA_UNAVAILABLE", "History is temporarily unavailable.");
      });
      res.json({
        documents: documents.map((d) => ({
          documentHash: d.document_hash,
          label: d.label,
          originalFilename: d.original_filename,
          txHash: d.tx_hash,
          timestamp: Number(d.block_timestamp),
          fileSizeBytes: d.file_size_bytes,
          contentType: d.content_type,
        })),
        total,
        ...page,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/documents/:hash/download — owner-only, short-lived signed URL.
   * Not-yours and doesn't-exist both return 404 so existence isn't leaked. Legacy rows
   * (no owner) are not downloadable by anyone through the API.
   */
  router.get("/:hash/download", authed, async (req, res, next) => {
    try {
      const documentHash = normalizeHash(req.params.hash);
      if (!documentHash) throw new HttpError(400, "INVALID_HASH", "Invalid hash.");

      const doc = await store.getDocumentByHash(documentHash).catch((err) => {
        log.error("[download] lookup failed", err);
        throw new HttpError(503, "METADATA_UNAVAILABLE", "Downloads are temporarily unavailable.");
      });
      if (!doc || !doc.user_id || doc.user_id !== req.user.id) {
        throw new HttpError(404, "NOT_FOUND", "Document not found.");
      }

      const expiresIn = config.downloads.signedUrlTtlSeconds;
      const url = await storage.signedDownloadUrl(doc.storage_key, {
        expiresIn,
        filename: doc.original_filename || `${documentHash}`,
      });
      res.set("Cache-Control", "no-store").json({ url, expiresInSeconds: expiresIn });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
