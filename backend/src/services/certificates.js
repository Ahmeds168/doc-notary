import { HttpError } from "../lib/errors.js";
import { renderCertificate } from "../lib/certificate.js";

/** `certificate-<first 12 hex chars of the hash>.pdf` (the 0x prefix is dropped). */
export function certificateFilename(documentHash) {
  return `certificate-${documentHash.replace(/^0x/, "").slice(0, 12)}.pdf`;
}

/**
 * Owner-only PDF certificates. Access rules match GET /:hash/download: someone else's
 * record, a missing record and a legacy row (no owner) are all the same 404.
 */
export function createCertificateService({ store, chain, config, log, render = renderCertificate, now = () => new Date() }) {
  const notFound = () => new HttpError(404, "NOT_FOUND", "Document not found.");
  const notConfirmed = () =>
    new HttpError(409, "NOT_CONFIRMED", "This notarization isn't confirmed on-chain yet. Try again in a minute.");

  async function db(fn) {
    try {
      return await fn();
    } catch (err) {
      log.error("[certificate] lookup failed", err);
      throw new HttpError(503, "METADATA_UNAVAILABLE", "Certificates are temporarily unavailable.");
    }
  }

  /** Resolve the confirmed record for this owner, preferring the indexed documents row. */
  async function resolveRecord(user, documentHash) {
    const doc = await db(() => store.getDocumentByHash(documentHash));
    if (doc) {
      if (!doc.user_id || doc.user_id !== user.id) throw notFound();
      const op = doc.operation_id ? await db(() => store.getOperation(doc.operation_id)) : null;
      if (op && op.status !== "confirmed") throw notConfirmed();
      return { doc, op };
    }
    // Confirmed but not yet indexed, or still pending: fall back to the operation.
    const op = await db(() => store.getActiveOperationByHash(documentHash));
    if (!op || op.user_id !== user.id) throw notFound();
    if (op.status !== "confirmed" || op.block_timestamp == null || !op.tx_hash) throw notConfirmed();
    return { doc: null, op };
  }

  async function blockNumberFor(txHash) {
    try {
      return (await chain.getReceipt(txHash))?.blockNumber ?? null;
    } catch (err) {
      log.warn("[certificate] block number lookup failed", err);
      return null;
    }
  }

  return {
    async forOwner(user, documentHash) {
      const { doc, op } = await resolveRecord(user, documentHash);
      const txHash = doc?.tx_hash ?? op.tx_hash;
      const blockNumber = op?.block_number != null ? Number(op.block_number) : await blockNumberFor(txHash);
      const explorer = config.network.explorerUrl;

      const pdf = await render({
        certificateId: op?.id ?? doc.operation_id ?? `document-${doc.id}`,
        documentHash,
        txHash,
        blockNumber,
        blockTimestamp: Number(doc?.block_timestamp ?? op.block_timestamp),
        label: doc?.label ?? op?.label ?? "",
        originalFilename: doc?.original_filename ?? op?.original_filename ?? null,
        network: { name: config.network.name, isTestnet: config.network.isTestnet },
        contractAddress: config.chain.contractAddress,
        verifyUrl: `${config.publicAppUrl}/verify/${documentHash}`,
        txUrl: explorer ? `${explorer}/tx/${txHash}` : undefined,
        issuedAt: now(),
      });
      return { pdf, filename: certificateFilename(documentHash) };
    },
  };
}
