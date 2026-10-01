import { ethers } from "ethers";

const HASH_RE = /^(0x)?([0-9a-fA-F]{64})$/;

/**
 * Canonical document hash form used for every DB lookup and chain call:
 * lowercase, 0x-prefixed, 32 bytes. Returns null for anything else.
 */
export function normalizeHash(input) {
  if (typeof input !== "string") return null;
  const match = HASH_RE.exec(input.trim());
  return match ? `0x${match[2].toLowerCase()}` : null;
}

/** Lowercased checksum-valid address, or null. */
export function normalizeAddress(input) {
  if (typeof input !== "string" || !ethers.isAddress(input.trim())) return null;
  return input.trim().toLowerCase();
}

export const PAGINATION = { defaultLimit: 20, maxLimit: 50, maxOffset: 10_000 };

/** Bound and coerce ?limit / ?offset. Returns null when the values are not sane integers. */
export function parsePagination(query = {}) {
  const limit = query.limit === undefined ? PAGINATION.defaultLimit : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(limit) || !Number.isInteger(offset) || limit < 1 || offset < 0) return null;
  return { limit: Math.min(limit, PAGINATION.maxLimit), offset: Math.min(offset, PAGINATION.maxOffset) };
}

export const MAX_LABEL_LENGTH = 64;

/**
 * Optional public on-chain label. Empty by default; anything sent here is published
 * on-chain permanently, so only an explicit, short, printable value is accepted.
 * Returns { ok, value } — value is "" when no label was provided.
 */
export function parseLabel(input) {
  if (input === undefined || input === null || input === "") return { ok: true, value: "" };
  if (typeof input !== "string") return { ok: false };
  const value = input.trim();
  // eslint-disable-next-line no-control-regex
  if (value.length > MAX_LABEL_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) return { ok: false };
  return { ok: true, value };
}

/** Strip path components / control chars from a client-supplied filename before storing it privately. */
export function sanitizeFilename(name) {
  if (typeof name !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const base = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return base ? base.slice(0, 255) : null;
}
