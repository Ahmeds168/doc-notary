import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotarizePanel } from "../components/NotarizePanel.jsx";
import { stubFetch, NETWORK } from "./fetchStub.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NotarizePanel", () => {
  it("offers 'Download certificate' on a confirmed result and links the tx via the configured explorer", async () => {
    const HASH = `0x${"12".repeat(32)}`;
    const TX = `0x${"34".repeat(32)}`;
    stubFetch({
      "/api/network": () => ({ body: NETWORK }),
      "/api/documents/notarize": () => ({
        status: 201,
        body: { operationId: "op-1", documentHash: HASH, outcome: "confirmed", status: "confirmed", txHash: TX, timestamp: 1791334703, metadataStatus: "available" },
      }),
    });
    const { container } = render(
      <NotarizePanel
        session={{ access_token: "tok" }}
        account={{ entitlements: { plan: "free", maxFileSizeBytes: 5 * 1024 * 1024 }, usage: { used: 0, limit: 3 } }}
      />
    );
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File(["hello"], "a.txt")] } });
    const submit = await screen.findByRole("button", { name: /Upload & notarize/ });
    await waitFor(() => expect(submit.disabled).toBe(false)); // hashing in the browser first
    fireEvent.click(submit);

    expect(await screen.findByRole("button", { name: "Download certificate" })).toBeTruthy();
    expect((await screen.findByText(/View on block explorer/)).getAttribute("href")).toBe(`${NETWORK.explorerUrl}/tx/${TX}`);
  });
});
