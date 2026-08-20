const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Request failed with status ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

export async function notarizeFile(file, onFormReady) {
  const form = new FormData();
  form.append("file", file);
  onFormReady?.(form);

  const res = await fetch(`${API_BASE_URL}/api/documents/notarize`, {
    method: "POST",
    body: form,
  });
  return handleResponse(res);
}

export async function verifyFile(file) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API_BASE_URL}/api/documents/verify`, {
    method: "POST",
    body: form,
  });
  return handleResponse(res);
}

export async function verifyHash(hash) {
  const res = await fetch(`${API_BASE_URL}/api/documents/verify/${hash}`);
  return handleResponse(res);
}

export async function listDocuments({ limit = 20, offset = 0, submitter } = {}) {
  const params = new URLSearchParams({ limit, offset });
  if (submitter) params.set("submitter", submitter);

  const res = await fetch(`${API_BASE_URL}/api/documents?${params.toString()}`);
  return handleResponse(res);
}

export async function getStats() {
  const res = await fetch(`${API_BASE_URL}/api/stats`);
  return handleResponse(res);
}

export { API_BASE_URL };
