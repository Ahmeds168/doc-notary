import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { sha256Hex, normalizeHash } from "../lib/hash.js";

describe("sha256Hex", () => {
  it("matches Node's SHA-256 (and therefore the backend's ethers.sha256)", async () => {
    const text = "hello notary";
    const file = new File([text], "a.txt");
    const expected = `0x${createHash("sha256").update(text).digest("hex")}`;
    expect(await sha256Hex(file)).toBe(expected);
  });
});

describe("normalizeHash", () => {
  it("lowercases and adds 0x; rejects malformed input", () => {
    const bare = "AB".repeat(32);
    expect(normalizeHash(bare)).toBe(`0x${"ab".repeat(32)}`);
    expect(normalizeHash(` 0x${bare} `)).toBe(`0x${"ab".repeat(32)}`);
    expect(normalizeHash("0x123")).toBeNull();
  });
});
