import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/api.js";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status = 201, body = { outcome: "confirmed" }) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("api", () => {
  it("there is no file-upload verify function", () => {
    expect(api.verifyFile).toBeUndefined();
  });

  it("notarizeFile sends the bearer token and does NOT send a label (filename) by default", async () => {
    const fetchMock = stubFetch();
    await api.notarizeFile(new File(["x"], "salary-review-jane-doe.pdf"), { token: "tok" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.body.has("label")).toBe(false);
    expect(init.body.get("file").name).toBe("salary-review-jane-doe.pdf");
  });

  it("notarizeFile sends an explicit opt-in label", async () => {
    const fetchMock = stubFetch();
    await api.notarizeFile(new File(["x"], "a.pdf"), { token: "tok", label: "Lease v2" });
    expect(fetchMock.mock.calls[0][1].body.get("label")).toBe("Lease v2");
  });

  it("errors carry status and code", async () => {
    stubFetch(402, { error: "quota", code: "QUOTA_EXCEEDED" });
    await expect(api.notarizeFile(new File(["x"], "a"), { token: "t" })).rejects.toMatchObject({ status: 402, code: "QUOTA_EXCEEDED" });
  });
});
