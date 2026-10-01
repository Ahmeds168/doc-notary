import { ethers } from "ethers";

export const RELAYER = "0x00000000000000000000000000000000000000aa";

/**
 * In-memory stand-in for the chain client (src/lib/contract.js#createChainClient).
 * Nothing touches a real network. Transactions are "mined" immediately unless
 * autoMine = false, in which case tests call mine().
 */
export function createFakeChain({ autoMine = true } = {}) {
  const records = new Map(); // hash -> { submitter, timestamp, label }
  const txs = new Map(); // txHash -> { hash, label, nonce, mined, status, blockNumber, known }
  let latestNonce = 0;
  let block = 100;

  const chain = {
    relayerAddress: RELAYER,
    autoMine,
    calls: { broadcast: 0, sign: 0, estimate: 0, verify: 0 },
    fail: {}, // e.g. fail.verify = Error, fail.broadcast = Error, fail.estimate = Error
    estimateCostWei: 1000n,

    async verify(hash) {
      chain.calls.verify++;
      if (chain.fail.verify) throw chain.fail.verify;
      const r = records.get(hash);
      return r ? { submitter: r.submitter, timestamp: r.timestamp, label: r.label, exists: true } : { submitter: ethers.ZeroAddress, timestamp: 0, label: "", exists: false };
    },
    async totalNotarized() {
      if (chain.fail.verify) throw chain.fail.verify;
      return records.size;
    },
    async estimateNotarize(hash) {
      chain.calls.estimate++;
      if (chain.fail.estimate) throw chain.fail.estimate;
      if (records.has(hash)) throw Object.assign(new Error("reverted"), { code: "CALL_EXCEPTION", revert: { name: "AlreadyNotarized" } });
      return { gasLimit: 100n, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n, costWei: chain.estimateCostWei };
    },
    async getPendingNonce() {
      return latestNonce + [...txs.values()].filter((t) => t.known && !t.mined).length;
    },
    async getLatestNonce() {
      return latestNonce;
    },
    async signNotarize(hash, label, { nonce }) {
      chain.calls.sign++;
      const txHash = ethers.keccak256(ethers.toUtf8Bytes(`${hash}:${nonce}:${chain.calls.sign}`));
      txs.set(txHash, { hash, label, nonce, mined: false, known: false });
      return { txHash, rawTx: txHash };
    },
    async broadcast(rawTx) {
      chain.calls.broadcast++;
      const tx = txs.get(rawTx);
      if (chain.fail.broadcast) {
        const err = chain.fail.broadcast;
        // A timeout may still have reached the node — model the worst case.
        if (err.reachedNode) tx.known = true;
        throw err;
      }
      tx.known = true;
      if (chain.autoMine) chain.mine(rawTx);
    },
    /** Mine one pending tx (or all). Reverts if the hash already exists. */
    mine(txHash) {
      const list = txHash ? [txs.get(txHash)] : [...txs.values()].filter((t) => t.known && !t.mined);
      for (const tx of list) {
        block++;
        tx.mined = true;
        tx.blockNumber = block;
        latestNonce = Math.max(latestNonce, tx.nonce + 1);
        if (records.has(tx.hash)) {
          tx.status = "reverted";
        } else {
          tx.status = "success";
          records.set(tx.hash, { submitter: RELAYER, timestamp: 1_700_000_000 + block, label: tx.label, txHash: [...txs.entries()].find(([, v]) => v === tx)[0] });
        }
      }
    },
    /** Simulate another tx consuming nonces (e.g. a replacement) without mining ours. */
    consumeNonce() {
      latestNonce++;
    },
    /** Notarize directly on "chain" as some other address (legacy / external). */
    seedRecord(hash, { submitter = RELAYER, label = "" } = {}) {
      records.set(hash, { submitter, timestamp: 1_600_000_000, label });
    },
    async getReceipt(txHash) {
      if (chain.fail.receipt) throw chain.fail.receipt;
      const tx = txs.get(txHash);
      if (!tx?.mined) return null;
      return { txHash, status: tx.status, blockNumber: tx.blockNumber, costWei: 900n };
    },
    async waitForReceipt(txHash) {
      return chain.getReceipt(txHash);
    },
    async isKnownTransaction(txHash) {
      return Boolean(txs.get(txHash)?.known);
    },
    async getBlockTimestamp(n) {
      return 1_700_000_000 + n;
    },
    async findNotarizationTx(hash) {
      const r = records.get(hash);
      return r?.txHash ? chain.getReceipt(r.txHash) : null;
    },
  };
  return chain;
}

export function createFakeStorage() {
  const objects = new Map();
  const storage = {
    objects,
    calls: { put: 0, delete: 0, sign: 0 },
    fail: {},
    async exists(key) {
      return objects.has(key);
    },
    async put(key, body) {
      storage.calls.put++;
      if (storage.fail.put) throw storage.fail.put;
      objects.set(key, Buffer.from(body));
    },
    async delete(key) {
      storage.calls.delete++;
      objects.delete(key);
    },
    async signedDownloadUrl(key, { expiresIn }) {
      storage.calls.sign++;
      return `https://r2.example.test/${key}?X-Amz-Expires=${expiresIn}&sig=fake`;
    },
  };
  return storage;
}

/** token -> user map. Anything else is rejected, exactly like a bad Supabase JWT. */
export function createFakeAuth() {
  const tokens = new Map();
  return {
    tokens,
    issue(user) {
      const token = `token-${user.id}`;
      tokens.set(token, user);
      return token;
    },
    async verify(token) {
      return tokens.get(token) ?? null;
    },
  };
}

export function silentLogger() {
  const lines = [];
  const push = (level) => (...args) => lines.push([level, args.map(String).join(" ")]);
  return { lines, info: push("info"), warn: push("warn"), error: push("error") };
}
