import { ethers } from "ethers";

// Minimal ABI — only what the backend needs. Keep in sync with contracts/DocumentNotary.sol.
export const ABI = [
  "function notarize(bytes32 documentHash, string label) external",
  "function verify(bytes32 documentHash) external view returns (address submitter, uint256 timestamp, string label, bool exists)",
  "function totalNotarized() external view returns (uint256)",
  "event DocumentNotarized(bytes32 indexed documentHash, address indexed submitter, uint256 timestamp, string label)",
  "error AlreadyNotarized(bytes32 documentHash)",
];

/** Convert a raw file buffer into the bytes32 SHA-256 hash used as the on-chain document ID. */
export function hashBuffer(buffer) {
  return ethers.sha256(buffer).toLowerCase();
}

// ethers error codes that mean the node definitely did NOT accept the transaction.
const DEFINITELY_NOT_SENT = new Set([
  "INSUFFICIENT_FUNDS",
  "NONCE_EXPIRED",
  "REPLACEMENT_UNDERPRICED",
  "CALL_EXCEPTION",
  "INVALID_ARGUMENT",
]);

/** Classify a broadcast error: "failed" (not sent) or "uncertain" (may have been sent). */
export function classifyBroadcastError(err) {
  return DEFINITELY_NOT_SENT.has(err?.code) ? "failed" : "uncertain";
}

/** True if an estimateGas/call error is the contract's AlreadyNotarized revert. */
export function isAlreadyNotarizedError(err, iface = new ethers.Interface(ABI)) {
  const data = err?.data ?? err?.info?.error?.data ?? err?.error?.data;
  if (typeof data === "string" && data.startsWith("0x")) {
    try {
      return iface.parseError(data)?.name === "AlreadyNotarized";
    } catch {
      return false;
    }
  }
  return err?.revert?.name === "AlreadyNotarized";
}

/**
 * Chain client for the relayer. Signing is done locally so the tx hash is known (and can be
 * persisted) BEFORE broadcast — a crash or RPC timeout mid-broadcast then leaves a hash the
 * reconciler can look up, instead of an unknowable outcome.
 */
export function createChainClient(config) {
  // Static network: no eth_chainId probing/retry loop, and txs are always signed for this chain.
  const network = ethers.Network.from(config.chain.chainId);
  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl, network, { staticNetwork: network });
  const wallet = new ethers.Wallet(config.chain.privateKey, provider);
  const contract = new ethers.Contract(config.chain.contractAddress, ABI, wallet);
  const iface = contract.interface;

  return {
    relayerAddress: wallet.address.toLowerCase(),

    async verify(documentHash) {
      const [submitter, timestamp, label, exists] = await contract.verify(documentHash);
      return { submitter: submitter.toLowerCase(), timestamp: Number(timestamp), label, exists };
    },

    async totalNotarized() {
      return Number(await contract.totalNotarized());
    },

    /** Estimate gas + worst-case cost. Throws (e.g. AlreadyNotarized revert) without spending. */
    async estimateNotarize(documentHash, label) {
      const [gasEstimate, fee] = await Promise.all([
        contract.notarize.estimateGas(documentHash, label),
        provider.getFeeData(),
      ]);
      const gasLimit = (gasEstimate * 120n) / 100n; // 20% headroom
      const maxFeePerGas = fee.maxFeePerGas ?? fee.gasPrice;
      const maxPriorityFeePerGas = fee.maxPriorityFeePerGas ?? 0n;
      return { gasLimit, maxFeePerGas, maxPriorityFeePerGas, costWei: gasLimit * maxFeePerGas };
    },

    async getPendingNonce() {
      return provider.getTransactionCount(wallet.address, "pending");
    },

    async getLatestNonce() {
      return provider.getTransactionCount(wallet.address, "latest");
    },

    /** Sign (no network side effects). Returns { txHash, rawTx }. */
    async signNotarize(documentHash, label, { nonce, gasLimit, maxFeePerGas, maxPriorityFeePerGas }) {
      const rawTx = await wallet.signTransaction({
        type: 2,
        chainId: network.chainId,
        to: config.chain.contractAddress,
        data: iface.encodeFunctionData("notarize", [documentHash, label]),
        nonce,
        gasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas,
      });
      return { txHash: ethers.keccak256(rawTx).toLowerCase(), rawTx };
    },

    async broadcast(rawTx) {
      await provider.broadcastTransaction(rawTx);
    },

    /** Receipt summary, or null if not mined (yet). */
    async getReceipt(txHash) {
      const receipt = await provider.getTransactionReceipt(txHash);
      return receipt ? summarizeReceipt(receipt) : null;
    },

    /** Wait up to timeoutMs for a receipt; null on timeout. */
    async waitForReceipt(txHash, timeoutMs) {
      try {
        const receipt = await provider.waitForTransaction(txHash, 1, timeoutMs);
        return receipt ? summarizeReceipt(receipt) : null;
      } catch (err) {
        if (err?.code === "TIMEOUT") return null;
        throw err;
      }
    },

    /** Whether the node knows about the transaction at all (mempool or mined). */
    async isKnownTransaction(txHash) {
      return (await provider.getTransaction(txHash)) !== null;
    },

    async getBlockTimestamp(blockNumber) {
      return (await provider.getBlock(blockNumber)).timestamp;
    },

    /** Find the DocumentNotarized event for a hash (used when no tx hash was recorded). */
    async findNotarizationTx(documentHash) {
      const logs = await contract.queryFilter(
        contract.filters.DocumentNotarized(documentHash),
        config.chain.deployBlock || 0
      );
      const log = logs[0];
      if (!log) return null;
      const receipt = await provider.getTransactionReceipt(log.transactionHash);
      return receipt ? summarizeReceipt(receipt) : null;
    },
  };
}

function summarizeReceipt(receipt) {
  const gasPrice = receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0n;
  return {
    txHash: receipt.hash.toLowerCase(),
    status: receipt.status === 1 ? "success" : "reverted",
    blockNumber: receipt.blockNumber,
    costWei: receipt.gasUsed * gasPrice,
  };
}
