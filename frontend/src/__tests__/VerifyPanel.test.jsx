import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createHash } from "node:crypto";
import { VerifyPanel } from "../components/VerifyPanel.jsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(body) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("VerifyPanel (browser-side verification)", () => {
  it("hashes the file locally and sends ONLY the hash — never the file", async () => {
    const content = "confidential board minutes";
    const expected = `0x${createHash("sha256").update(content).digest("hex")}`;
    const fetchMock = stubFetch({
      documentHash: expected,
      verified: true,
      onChain: { exists: true, timestamp: 1700000000, submitter: "0x00000000000000000000000000000000000000aa", label: "" },
      metadata: null,
      metadataStatus: "unavailable",
    });

    const { container } = render(<VerifyPanel />);
    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [new File([content], "minutes.pdf", { type: "application/pdf" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await screen.findByText(/Record found/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(new RegExp(`/api/documents/verify/${expected}$`));
    // No request body, no FormData, no File/Blob, no filename anywhere in the request.
    expect(init?.body).toBeUndefined();
    expect(init?.method ?? "GET").toBe("GET");
    const serialized = JSON.stringify([url, init ?? null]);
    expect(serialized).not.toContain("minutes.pdf");
    expect(serialized).not.toContain(content);

    // Metadata outage is surfaced, but the proof still shows as found.
    expect(screen.getByText(/temporarily unavailable/)).toBeTruthy();
  });

  it("pasted hashes are normalized before the request", async () => {
    const fetchMock = stubFetch({ documentHash: `0x${"ab".repeat(32)}`, verified: false, onChain: { exists: false }, metadata: null, metadataStatus: "not_applicable" });
    render(<VerifyPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Paste hash" }));
    fireEvent.change(screen.getByLabelText("Document hash"), { target: { value: "AB".repeat(32) } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toMatch(new RegExp(`/verify/0x${"ab".repeat(32)}$`));
    await screen.findByText(/No record found/);
  });
});
