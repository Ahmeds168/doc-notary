const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Request failed with status ${res.status}`);
    error.status = res.status;
    error.code = data.code;
    error.data = data;
    throw error;
  }
  return Object.assign(data, { httpStatus: res.status });
}

const authHeaders = (token) => (token ? { Authorization: `Bearer ${token}` } : {});

/**
 * Notarize: the FILE IS UPLOADED to the backend and stored privately (Cloudflare R2) so you
 * can download your original later. Only its SHA-256 hash — plus `label`, if you opt in —
 * is written on-chain. `label` is public and permanent; it is omitted unless non-empty.
 */
export async function notarizeFile(file, { token, label } = {}) {
  const form = new FormData();
  if (label) form.append("label", label);
  form.append("file", file);

  const res = await fetch(`${API_BASE_URL}/api/documents/notarize`, {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
  return handleResponse(res);
}

/**
 * Verify: only the hash is sent. Callers hash files locally first (see lib/hash.js) —
 * there is intentionally no "verify by file upload" API.
 */
export async function verifyHash(hash) {
  const res = await fetch(`${API_BASE_URL}/api/documents/verify/${encodeURIComponent(hash)}`);
  return handleResponse(res);
}

export async function getOperation(operationId, token) {
  const res = await fetch(`${API_BASE_URL}/api/documents/operations/${operationId}`, { headers: authHeaders(token) });
  return handleResponse(res);
}

export async function listMyDocuments({ token, limit = 20, offset = 0 }) {
  const params = new URLSearchParams({ limit, offset });
  const res = await fetch(`${API_BASE_URL}/api/documents/mine?${params}`, { headers: authHeaders(token) });
  return handleResponse(res);
}

export async function getDownloadUrl(hash, token) {
  const res = await fetch(`${API_BASE_URL}/api/documents/${hash}/download`, { headers: authHeaders(token) });
  return handleResponse(res);
}

export async function getMe(token) {
  const res = await fetch(`${API_BASE_URL}/api/me`, { headers: authHeaders(token) });
  return handleResponse(res);
}

/** `certificate-<first 12 hex chars of the hash>.pdf` — matches the backend's Content-Disposition. */
/** Paid plan: Kelviq hosted checkout for the signed-in user. period = "monthly" | "yearly". */
export async function startCheckout(period, token) {
  const res = await fetch(`${API_BASE_URL}/api/billing/checkout`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ period }),
  });
  return handleResponse(res);
}

/** Kelviq customer portal (manage payment method, cancel). */
export async function openBillingPortal(token) {
  const res = await fetch(`${API_BASE_URL}/api/billing/portal`, { method: "POST", headers: authHeaders(token) });
  return handleResponse(res);
}

/** Re-check the subscription with Kelviq right now (used after returning from checkout). */
export async function syncBilling(token) {
  const res = await fetch(`${API_BASE_URL}/api/billing/sync?from=checkout`, { method: "POST", headers: authHeaders(token) });
  return handleResponse(res);
}

export function certificateFilename(hash) {
  return `certificate-${String(hash).replace(/^0x/, "").slice(0, 12)}.pdf`;
}

/** Owner-only PDF certificate. Resolves to a Blob; errors carry status/code like other calls. */
export async function fetchCertificate(hash, token) {
  const res = await fetch(`${API_BASE_URL}/api/documents/${hash}/certificate`, { headers: authHeaders(token) });
  if (!res.ok) return handleResponse(res);
  return res.blob();
}

let networkPromise = null;
/** Public network details ({ name, isTestnet, explorerUrl, contractAddress }), fetched once per page load. */
export function getNetwork() {
  if (!networkPromise) {
    networkPromise = fetch(`${API_BASE_URL}/api/network`)
      .then(handleResponse)
      .catch((err) => {
        networkPromise = null; // allow a retry later (e.g. after a cold start)
        throw err;
      });
  }
  return networkPromise;
}

export async function getStats() {
  const res = await fetch(`${API_BASE_URL}/api/stats`);
  return handleResponse(res);
}

export { API_BASE_URL };
