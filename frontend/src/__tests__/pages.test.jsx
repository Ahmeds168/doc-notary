import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "../App.jsx";
import { resolvePage } from "../lib/routes.js";
import { stubFetch, NETWORK } from "./fetchStub.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function renderAt(path) {
  window.history.replaceState(null, "", path);
  stubFetch({
    "/api/stats": () => ({ body: { totalNotarized: 1 } }),
    "/api/network": () => ({ body: NETWORK }),
  });
  return render(<App />);
}

const meta = (name) => document.head.querySelector(`meta[name="${name}"]`)?.getAttribute("content");

describe("resolvePage", () => {
  it("maps known paths, keeps verify/confirm links on home, and 404s everything else", () => {
    expect(resolvePage("/")).toBe("home");
    expect(resolvePage("/pricing")).toBe("pricing");
    expect(resolvePage("/pricing/")).toBe("pricing");
    expect(resolvePage("/about")).toBe("about");
    expect(resolvePage("/contact")).toBe("about");
    expect(resolvePage("/terms")).toBe("terms");
    expect(resolvePage("/privacy")).toBe("privacy");
    expect(resolvePage("/refund-policy")).toBe("refund");
    expect(resolvePage(`/verify/0x${"ab".repeat(32)}`)).toBe("home");
    expect(resolvePage("/verify/not-a-hash")).toBe("home"); // the verify panel explains the bad link
    expect(resolvePage("/auth/confirm")).toBe("home");
    expect(resolvePage("/made-up-page")).toBe("notFound");
    expect(resolvePage("/pricing/extra")).toBe("notFound");
  });
});

const ROUTES = [
  ["/pricing", /Simple plans for proving when a file existed/, "Pricing — Doc Notary"],
  ["/about", /About Doc Notary/, "About & Contact — Doc Notary"],
  ["/contact", /About Doc Notary/, "About & Contact — Doc Notary"],
  ["/terms", /^Terms of Service$/, "Terms of Service — Doc Notary"],
  ["/privacy", /^Privacy Policy$/, "Privacy Policy — Doc Notary"],
  ["/refund-policy", /^Refund Policy$/, "Refund Policy — Doc Notary"],
];

describe("site pages", () => {
  it.each(ROUTES)("%s renders its page with its own title and description", (path, heading, title) => {
    renderAt(path);
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeTruthy();
    expect(document.title).toBe(title);
    expect(meta("description")).toBeTruthy();
    expect(meta("robots")).toBeUndefined();
    expect(screen.queryByText(/Prove a file existed/)).toBeNull(); // not the home page
  });

  it("an unknown path shows Page not found with a link home, marked noindex", () => {
    renderAt("/definitely-not-a-page");
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /home page/ }).getAttribute("href")).toBe("/");
    expect(document.title).toBe("Page not found — Doc Notary");
    expect(meta("robots")).toBe("noindex");
    expect(screen.queryByText(/Prove a file existed/)).toBeNull();
  });

  it("the home page still renders the app, with its original title and description", () => {
    renderAt("/");
    expect(document.title).toBe("Document Notary — Proof of Existence on Sepolia");
    expect(meta("description")).toBe(
      "Notarize any file with a tamper-proof on-chain hash. Verify authenticity and timestamp in seconds."
    );
    expect(screen.getByText(/Prove a file existed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verify" })).toBeTruthy();
  });

  it("legal pages show the last-updated date and the closing note", () => {
    for (const path of ["/terms", "/privacy", "/refund-policy"]) {
      renderAt(path);
      expect(screen.getByText("Last updated: 28 October 2026")).toBeTruthy();
      expect(screen.getByText(/provided in good faith for a small independent service/)).toBeTruthy();
      cleanup();
    }
  });

  it("the beta notice appears on Pricing, Terms and Refund Policy", () => {
    for (const path of ["/pricing", "/terms", "/refund-policy"]) {
      renderAt(path);
      expect(screen.getByRole("note").textContent).toMatch(/Ethereum Sepolia test network, which may be reset or retired/);
      cleanup();
    }
  });

  it("new pages never describe proofs as permanent, forever or immutable", () => {
    for (const [path] of [...ROUTES, ["/nope"]]) {
      const { container } = renderAt(path);
      expect(container.textContent).not.toMatch(/permanent|forever|immutable/i);
      cleanup();
    }
  });
});

describe("footer", () => {
  it.each(["/", "/pricing", "/nope"])("is on %s with every link and the contact line", (path) => {
    renderAt(path);
    const footer = screen.getByRole("contentinfo");
    const links = within(footer)
      .getAllByRole("link")
      .map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Pricing", "/pricing"],
      ["About & Contact", "/about"],
      ["Terms", "/terms"],
      ["Privacy", "/privacy"],
      ["Refund Policy", "/refund-policy"],
    ]);
    expect(footer.textContent).toContain(
      "© 2026 Syed Ahmed Ali Shah, trading as Doc Notary · Sukkur, Pakistan · support@doc-notary.com"
    );
  });
});

describe("pricing page", () => {
  it("shows plan numbers, free unlimited verification, and the CTAs", () => {
    renderAt("/pricing");
    expect(screen.getByText("3 notarizations per month")).toBeTruthy();
    expect(screen.getByText("Files up to 5 MB")).toBeTruthy();
    expect(screen.getByText("25 notarizations per month")).toBeTruthy();
    expect(screen.getByText("Files up to 25 MB")).toBeTruthy();
    expect(screen.getByText("Email support")).toBeTruthy();
    expect(screen.getByText("PDF proof certificate when you notarize")).toBeTruthy();
    expect(screen.getByText("PDF proof certificates, downloadable any time")).toBeTruthy();
    expect(screen.getByText(/Verification is free and unlimited on both plans, and needs no account/)).toBeTruthy();
    expect(screen.getByText(/US\$5/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start free" }).getAttribute("href")).toBe("/?signup=1");

    // Signed out: sign up first, carrying the chosen billing period through.
    expect(screen.getByRole("link", { name: "Get Standard monthly" }).getAttribute("href")).toBe("/?signup=1&upgrade=monthly");
    expect(screen.getByRole("link", { name: "or pay US$49 yearly" }).getAttribute("href")).toBe("/?signup=1&upgrade=yearly");
    expect(screen.getByText(/added at checkout/)).toBeTruthy();
  });
});
