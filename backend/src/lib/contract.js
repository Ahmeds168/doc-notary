import { ethers } from "ethers";
import { config } from "../config.js";

// Minimal ABI — only what the backend needs. Keep in sync with contracts/DocumentNotary.sol.
const ABI = [
  "function notarize(bytes32 documentHash, string label) external",
  "function verify(bytes32 documentHash) external view returns (address submitter, uint256 timestamp, string label, bool exists)",
  "function getHashesBySubmitter(address submitter) external view returns (bytes32[])",
  "function getSubmitterCount(address submitter) external view returns (uint256)",
  "function totalNotarized() external view returns (uint256)",
  "event DocumentNotarized(bytes32 indexed documentHash, address indexed submitter, uint256 timestamp, string label)",
];

let providerInstance;
let walletInstance;
let contractInstance;

function getProvider() {
  if (!providerInstance) {
    providerInstance = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  }
  return providerInstance;
}

function getWallet() {
  if (!walletInstance) {
    walletInstance = new ethers.Wallet(config.chain.privateKey, getProvider());
  }
  return walletInstance;
}

function getContract() {
  if (!contractInstance) {
    contractInstance = new ethers.Contract(config.chain.contractAddress, ABI, getWallet());
  }
  return contractInstance;
}

/** Convert a raw file buffer into the bytes32 SHA-256 hash used as the on-chain document ID. */
export function hashBuffer(buffer) {
  // ethers.sha256 expects bytes-like input and returns a 0x-prefixed 32-byte hex string.
  return ethers.sha256(buffer);
}

/**
 * Notarize a document hash on-chain. The backend wallet pays gas (relayer pattern) —
 * this keeps the UX simple for users who don't have their own funded wallet/MetaMask.
 */
export async function notarizeOnChain(documentHash, label) {
  const contract = getContract();
  const tx = await contract.notarize(documentHash, label ?? "");
  const receipt = await tx.wait();

  const block = await getProvider().getBlock(receipt.blockNumber);

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    blockTimestamp: block.timestamp,
    submitter: await getWallet().getAddress(),
  };
}

/** Read-only verification lookup — does not require gas. */
export async function verifyOnChain(documentHash) {
  const contract = getContract();
  const [submitter, timestamp, label, exists] = await contract.verify(documentHash);
  return {
    submitter,
    timestamp: Number(timestamp),
    label,
    exists,
  };
}

export async function getTotalNotarized() {
  const contract = getContract();
  const total = await contract.totalNotarized();
  return Number(total);
}
