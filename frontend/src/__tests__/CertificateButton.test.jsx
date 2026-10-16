import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CertificateButton } from "../components/CertificateButton.jsx";
import { Ledger } from "../components/Ledger.jsx";
import { stubFetch } from "./fetchStub.js";

const HASH = `0x${"9f86d081884c".padEnd(64, "0")}`;
let downloads;

beforeEach(() => {
  downloads = [];
  URL.createObjectURL = vi.fn(() => "blob:certificate");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click() {
    downloads.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const pdfResponse = () =>
  new Response(new TextEncoder().encode("%PDF-1.7 test"), {
    status: 200,
    headers: { "Content-Type": "application/pdf" },
  });

describe("CertificateButton", () => {
  it("fetches the certificate with the session token and saves certificate-<12 hex>.pdf", async () => {
    const fetchMock = stubFetch({ "/certificate": () => pdfResponse() });
    render(<CertificateButton hash={HASH} token="tok-123" />);
    fireEvent.click(screen.getByRole("button", { name: "Download certificate" }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(new RegExp(`/api/documents/${HASH}/certificate$`));
    expect(init.headers.Authorization).toBe("Bearer tok-123");
    expect(downloads[0].download).toBe("certificate-9f86d081884c.pdf");
  });

  it("shows a friendly error when the record isn't confirmed yet", async () => {
    stubFetch({ "/certificate": () => ({ status: 409, body: { error: "x", code: "NOT_CONFIRMED" } }) });
    render(<CertificateButton hash={HASH} token="tok" />);
    fireEvent.click(screen.getByRole("button", { name: "Download certificate" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/still being confirmed/);
    expect(downloads).toHaveLength(0);
  });
});

describe("Ledger certificate button", () => {
  it("each history row downloads that document's certificate with the auth header", async () => {
    const fetchMock = stubFetch({
      "/api/documents/mine": () => ({
        body: {
          documents: [{ documentHash: HASH, originalFilename: "a.pdf", label: "", txHash: "0x1", timestamp: 1791334703 }],
          total: 1,
        },
      }),
      "/certificate": () => pdfResponse(),
    });
    render(
      <Ledger
        session={{ access_token: "tok-ledger" }}
        account={{ entitlements: { historyDashboard: true } }}
        refreshKey={0}
      />
    );
    // The original-file button is labelled distinctly so the two downloads aren't confused.
    expect(await screen.findByRole("button", { name: "Original file" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Certificate (PDF)" }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/certificate"));
    expect(call[0]).toMatch(new RegExp(`/api/documents/${HASH}/certificate$`));
    expect(call[1].headers.Authorization).toBe("Bearer tok-ledger");
  });
});
