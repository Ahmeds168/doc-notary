import { Router } from "express";
import { upload } from "../middleware/upload.js";
import { hashBuffer, notarizeOnChain, verifyOnChain } from "../lib/contract.js";
import { uploadToR2, objectExists, keyForHash, getSignedDownloadUrl } from "../lib/r2.js";
import { insertDocumentRecord, getDocumentByHash, listDocuments } from "../lib/supabase.js";

export const documentsRouter = Router();

/**
 * POST /api/documents/notarize
 * Multipart form upload: field "file".
 * Hashes the file, stores it in R2 (content-addressed, deduped), notarizes the
 * hash on-chain, then indexes the result in Supabase for fast search/listing.
 */
documentsRouter.post("/notarize", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided. Use multipart field 'file'." });
    }

    const { buffer, originalname, mimetype, size } = req.file;
    const documentHash = hashBuffer(buffer);

    // Guard against re-notarizing a document that's already on-chain.
    const existingOnChain = await verifyOnChain(documentHash);
    if (existingOnChain.exists) {
      return res.status(409).json({
        error: "Document already notarized.",
        documentHash,
        record: existingOnChain,
      });
    }

    const storageKey = keyForHash(documentHash, originalname);
    let publicUrl = null;
    if (!(await objectExists(storageKey))) {
      publicUrl = await uploadToR2({ key: storageKey, body: buffer, contentType: mimetype });
    }

    const chainResult = await notarizeOnChain(documentHash, originalname?.slice(0, 100) ?? "");

    const record = await insertDocumentRecord({
      documentHash,
      label: originalname,
      submitterAddress: chainResult.submitter.toLowerCase(),
      txHash: chainResult.txHash,
      blockTimestamp: chainResult.blockTimestamp,
      storageKey,
      fileSizeBytes: size,
      contentType: mimetype,
    });

    res.status(201).json({
      message: "Document notarized successfully.",
      documentHash,
      txHash: chainResult.txHash,
      blockNumber: chainResult.blockNumber,
      timestamp: chainResult.blockTimestamp,
      publicUrl,
      record,
    });
  } catch (err) {
    console.error("[POST /notarize] error:", err);
    res.status(500).json({ error: "Failed to notarize document.", details: err.message });
  }
});

/**
 * POST /api/documents/verify
 * Multipart form upload: field "file".
 * Hashes the uploaded file and checks on-chain (source of truth) + Supabase (metadata).
 * Use this to prove a file is unmodified / matches a prior notarization.
 */
documentsRouter.post("/verify", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided. Use multipart field 'file'." });
    }

    const documentHash = hashBuffer(req.file.buffer);
    const onChain = await verifyOnChain(documentHash);
    const metadata = onChain.exists ? await getDocumentByHash(documentHash) : null;

    res.json({
      documentHash,
      verified: onChain.exists,
      onChain,
      metadata,
    });
  } catch (err) {
    console.error("[POST /verify] error:", err);
    res.status(500).json({ error: "Failed to verify document.", details: err.message });
  }
});

/**
 * GET /api/documents/verify/:hash
 * Look up an already-known hash (no file upload needed) — e.g. from a shared link or QR code.
 */
documentsRouter.get("/verify/:hash", async (req, res) => {
  try {
    const documentHash = req.params.hash;
    if (!/^0x[0-9a-fA-F]{64}$/.test(documentHash)) {
      return res.status(400).json({ error: "Invalid hash format. Expected 0x-prefixed 32-byte hex." });
    }

    const onChain = await verifyOnChain(documentHash);
    const metadata = onChain.exists ? await getDocumentByHash(documentHash) : null;

    res.json({ documentHash, verified: onChain.exists, onChain, metadata });
  } catch (err) {
    console.error("[GET /verify/:hash] error:", err);
    res.status(500).json({ error: "Failed to verify document.", details: err.message });
  }
});

/**
 * GET /api/documents
 * List notarized documents, newest first. Optional ?submitter=0x... filter and pagination.
 */
documentsRouter.get("/", async (req, res) => {
  try {
    const { submitter, limit, offset } = req.query;
    const { data, count } = await listDocuments({
      submitterAddress: submitter,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });

    res.json({ documents: data, total: count });
  } catch (err) {
    console.error("[GET /] error:", err);
    res.status(500).json({ error: "Failed to list documents.", details: err.message });
  }
});

/**
 * GET /api/documents/:hash/download
 * Returns a short-lived signed URL to download the original file from R2.
 */
documentsRouter.get("/:hash/download", async (req, res) => {
  try {
    const documentHash = req.params.hash;
    const metadata = await getDocumentByHash(documentHash);

    if (!metadata) {
      return res.status(404).json({ error: "Document not found." });
    }

    const url = await getSignedDownloadUrl(metadata.storage_key);
    res.json({ url, expiresInSeconds: 900 });
  } catch (err) {
    console.error("[GET /:hash/download] error:", err);
    res.status(500).json({ error: "Failed to generate download URL.", details: err.message });
  }
});
