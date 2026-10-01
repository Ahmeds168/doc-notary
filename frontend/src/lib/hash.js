/** Compute the SHA-256 hash of a File as a 0x-prefixed hex string, matching contract's ethers.sha256. */
export async function sha256Hex(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = new Uint8Array(digest);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

/** Accepts 0x-prefixed or bare 64-char hex in any case; returns lowercase 0x form or null. */
export function normalizeHash(input) {
  const match = /^(0x)?([0-9a-fA-F]{64})$/.exec(String(input ?? "").trim());
  return match ? `0x${match[2].toLowerCase()}` : null;
}

export function truncateHash(hash, chars = 6) {
  if (!hash) return "";
  return `${hash.slice(0, 2 + chars)}…${hash.slice(-chars)}`;
}

export function truncateAddress(address, chars = 4) {
  if (!address) return "";
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

export function formatTimestamp(unixSeconds) {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
