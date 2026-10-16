import { describe, expect, it } from "vitest";
import { readVerifyRoute } from "../lib/routes.js";

const H = `0x${"ab".repeat(32)}`;

describe("readVerifyRoute", () => {
  it("parses /verify/:hash and normalizes the hash", () => {
    expect(readVerifyRoute(`/verify/${H}`)).toEqual({ hash: H });
    expect(readVerifyRoute(`/verify/${"AB".repeat(32)}/`)).toEqual({ hash: H });
  });
  it("flags malformed hashes and ignores other paths", () => {
    expect(readVerifyRoute("/verify/0x123")).toEqual({ invalid: "0x123" });
    expect(readVerifyRoute("/")).toBeNull();
    expect(readVerifyRoute("/auth/confirm")).toBeNull();
    expect(readVerifyRoute(`/verify/${H}/extra`)).toBeNull();
  });
});
