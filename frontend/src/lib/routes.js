import { normalizeHash } from "./hash.js";

export const VERIFY_PATH_PREFIX = "/verify/";

/**
 * Public verify links: /verify/<hash>.
 * Returns null for other paths, { hash } for a valid hash, or { invalid: raw } otherwise.
 */
export function readVerifyRoute(pathname) {
  const match = /^\/verify\/([^/]+)\/?$/.exec(pathname || "");
  if (!match) return null;
  const raw = decodeURIComponent(match[1]);
  const hash = normalizeHash(raw);
  return hash ? { hash } : { invalid: raw };
}

export function verifyPath(hash) {
  return `${VERIFY_PATH_PREFIX}${hash}`;
}
