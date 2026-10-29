import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { stubFetch } from "./fetchStub.js";

const session = { access_token: "tok-123", user: { email: "a@example.com" } };
let currentSession = null;
vi.mock("../lib/useSession.js", () => ({
  useSession: () => ({ session: currentSession, ready: true, authConfigured: true }),
}));

const { PricingPage } = await import("../components/pages/PricingPage.jsx");
const billing = await import("../lib/billing.js");

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  currentSession = null;
  window.history.replaceState(null, "", "/");
});

describe("upgrade intent", () => {
  it("reads ?upgrade=, remembers it through email confirmation for an hour, and ignores junk", () => {
    expect(billing.readUpgradeIntent("?upgrade=yearly", window.localStorage, 1000)).toBe("yearly");
    expect(billing.readUpgradeIntent("", window.localStorage, 1000 + 30 * 60_000)).toBe("yearly");
    expect(billing.readUpgradeIntent("", window.localStorage, 1000 + 61 * 60_000)).toBeNull();
    window.localStorage.clear();
    expect(billing.readUpgradeIntent("?upgrade=weekly", window.localStorage, 0)).toBeNull();
  });

  it("clearBillingParams drops the one-shot parameters and the saved intent", () => {
    window.history.replaceState(null, "", "/?signup=1&upgrade=monthly&checkout=success&keep=1");
    billing.readUpgradeIntent();
    billing.clearBillingParams();
    expect(window.location.search).toBe("?keep=1");
    expect(billing.readUpgradeIntent()).toBeNull();
  });
});

describe("Pricing page when signed in", () => {
  it("starts a Kelviq checkout for the chosen period with the user's token", async () => {
    currentSession = session;
    const fetchMock = stubFetch({
      "/api/me": () => ({ body: { plan: "free" } }),
      "/api/billing/checkout": () => ({ body: { url: "https://checkout.kelviq.test/x" } }),
    });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });

    render(<PricingPage />);
    fireEvent.click(screen.getByRole("button", { name: "or pay US$49 yearly" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.kelviq.test/x"));

    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/billing/checkout"));
    expect(init.headers.Authorization).toBe("Bearer tok-123");
    expect(JSON.parse(init.body)).toEqual({ period: "yearly" });
  });

  it("shows a readable error when checkout fails", async () => {
    currentSession = session;
    stubFetch({
      "/api/me": () => ({ body: { plan: "free" } }),
      "/api/billing/checkout": () => ({ status: 502, body: { code: "BILLING_ERROR" } }),
    });
    render(<PricingPage />);
    fireEvent.click(screen.getByRole("button", { name: "Get Standard monthly" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't open checkout/);
  });

  it("offers Manage subscription to Standard users instead of another checkout", async () => {
    currentSession = session;
    stubFetch({
      "/api/me": () => ({ body: { plan: "standard" } }),
      "/api/billing/portal": () => ({ body: { url: "https://portal.kelviq.test/x" } }),
    });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<PricingPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Manage subscription" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://portal.kelviq.test/x"));
    expect(screen.queryByRole("button", { name: "Get Standard monthly" })).toBeNull();
  });
});
