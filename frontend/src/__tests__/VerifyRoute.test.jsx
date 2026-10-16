import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import App from "../App.jsx";
import { stubFetch, NETWORK } from "./fetchStub.js";

const HASH = `0x${"9f".repeat(32)}`;
const TX = `0x${"5c".repeat(32)}`;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("/verify/:hash public route", () => {
  it("pre-fills the hash, runs verify automatically and shows time, network and explorer link", async () => {
    window.history.replaceState(null, "", `/verify/${HASH.toUpperCase().replace("0X", "0x")}`);
    const fetchMock = stubFetch({
      "/api/stats": () => ({ body: { totalNotarized: 7 } }),
      "/api/network": () => ({ body: NETWORK }),
      "/api/documents/verify/": () => ({
        body: {
          documentHash: HASH,
          verified: true,
          onChain: { exists: true, timestamp: 1791334703, submitter: "0x00000000000000000000000000000000000000aa", label: "" },
          metadata: { txHash: TX, blockTimestamp: 1791334703 },
          metadataStatus: "available",
        },
      }),
    });

    render(<App />);

    expect(screen.getByLabelText("Document hash").value).toBe(HASH);
    await screen.findByText(/Record found/);

    const verifyCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/documents/verify/"));
    expect(verifyCalls).toHaveLength(1); // once, even under StrictMode-style double effects
    expect(verifyCalls[0][0]).toMatch(new RegExp(`/api/documents/verify/${HASH}$`));
    expect(verifyCalls[0][1]?.body).toBeUndefined(); // only the hash, in the URL
    expect(verifyCalls[0][1]?.headers?.Authorization).toBeUndefined(); // no account needed

    expect(screen.getByText("2026-10-07T00:58:23Z")).toBeTruthy();
    expect(await screen.findByText(NETWORK.name)).toBeTruthy();
    expect(screen.getByText(/View on block explorer/).getAttribute("href")).toBe(`${NETWORK.explorerUrl}/tx/${TX}`);
  });

  it("shows a friendly error for a malformed link and does not call verify", async () => {
    window.history.replaceState(null, "", "/verify/not-a-hash");
    const fetchMock = stubFetch({
      "/api/stats": () => ({ body: { totalNotarized: 0 } }),
      "/api/network": () => ({ body: NETWORK }),
    });
    render(<App />);
    expect(screen.getByText(/doesn't contain a valid document hash/)).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/documents/verify/"))).toBe(false);
  });
});
