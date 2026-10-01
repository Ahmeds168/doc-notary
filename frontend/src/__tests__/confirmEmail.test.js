import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmEmailFromUrl, readConfirmationParams, _resetConfirmationState } from "../lib/confirmEmail.js";

const loc = (url) => new URL(url, "https://doc-notary.vercel.app");

afterEach(() => _resetConfirmationState());

describe("readConfirmationParams", () => {
  it("only matches /auth/confirm with a token hash and an allowed type", () => {
    expect(readConfirmationParams(loc("/"))).toBeNull();
    expect(readConfirmationParams(loc("/auth/confirm?token_hash=abc&type=email"))).toEqual({ tokenHash: "abc", type: "email" });
    expect(readConfirmationParams(loc("/auth/confirm/?token_hash=abc&type=email"))).toEqual({ tokenHash: "abc", type: "email" });
    expect(readConfirmationParams(loc("/auth/confirm?token_hash=abc&type=recovery"))).toEqual({ invalid: true });
    expect(readConfirmationParams(loc("/auth/confirm?type=email"))).toEqual({ invalid: true });
  });
});

describe("confirmEmailFromUrl", () => {
  const history = () => ({ replaceState: vi.fn() });

  it("verifies the token once, even if called twice (StrictMode), and cleans the URL", async () => {
    const client = { auth: { verifyOtp: vi.fn(async () => ({ error: null })) } };
    const h = history();
    const location = loc("/auth/confirm?token_hash=tok123&type=email");
    const [a, b] = await Promise.all([
      confirmEmailFromUrl(client, { location, history: h }),
      confirmEmailFromUrl(client, { location, history: h }),
    ]);
    expect([a, b]).toEqual(["confirmed", "confirmed"]);
    expect(client.auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "tok123", type: "email" });
    expect(h.replaceState).toHaveBeenCalledWith(null, "", "/");
  });

  it("reports failure for an expired/used token", async () => {
    const client = { auth: { verifyOtp: vi.fn(async () => ({ error: new Error("expired") })) } };
    const result = await confirmEmailFromUrl(client, { location: loc("/auth/confirm?token_hash=old&type=email"), history: history() });
    expect(result).toBe("failed");
  });

  it("does nothing on normal pages", async () => {
    const client = { auth: { verifyOtp: vi.fn() } };
    expect(await confirmEmailFromUrl(client, { location: loc("/"), history: history() })).toBeNull();
    expect(client.auth.verifyOtp).not.toHaveBeenCalled();
  });
});
