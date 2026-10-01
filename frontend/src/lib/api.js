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

export async function getStats() {
  const res = await fetch(`${API_BASE_URL}/api/stats`);
  return handleResponse(res);
}

export { API_BASE_URL };
