import { normalizeHash } from "./hash.js";

export const VERIFY_PATH_PREFIX = "/verify/";

/**
 * Public verify links: /verify/<hash>.
 * Returns null for other paths, { hash } for a valid hash, or { invalid: raw } otherwise.
 */
export function readVerifyRoute(pathname) {
  const match = /^\/verify\/([^/]+)\/?$/.exec(pathname || "");
  if (!match) return null;
  const raw = decodeURIComponent(match[1]);
  const hash = normalizeHash(raw);
  return hash ? { hash } : { invalid: raw };
}

export function verifyPath(hash) {
  return `${VERIFY_PATH_PREFIX}${hash}`;
}

/**
 * Path -> page. No router library: the page is chosen once from location.pathname, and every
 * internal link is a real <a href> (full page load), so pages work when opened directly or crawled.
 */
export const PAGE_PATHS = Object.freeze({
  "/": "home",
  "/pricing": "pricing",
  "/about": "about",
  "/contact": "about",
  "/terms": "terms",
  "/privacy": "privacy",
  "/refund-policy": "refund",
});

export const PAGE_META = Object.freeze({
  home: {
    title: "Document Notary — Proof of Existence on Sepolia",
    description: "Record a file's SHA-256 fingerprint on a public blockchain and verify it later in your browser.",
  },
  pricing: {
    title: "Pricing — Doc Notary",
    description: "Doc Notary plans: Free and Standard. Verification is free and unlimited, with no account needed.",
  },
  about: {
    title: "About & Contact — Doc Notary",
    description: "Who runs Doc Notary, what it does, who it's for, and how to get in touch.",
  },
  terms: {
    title: "Terms of Service — Doc Notary",
    description: "The terms that apply when you use Doc Notary.",
  },
  privacy: {
    title: "Privacy Policy — Doc Notary",
    description: "What Doc Notary collects, what becomes public on the blockchain, and how to request deletion.",
  },
  refund: {
    title: "Refund Policy — Doc Notary",
    description: "How refunds and cancellations work for Doc Notary's paid plans.",
  },
  notFound: {
    title: "Page not found — Doc Notary",
    description: "This page doesn't exist on Doc Notary.",
  },
});

/** The page to render for a pathname. Unknown paths are "notFound", never the home page. */
export function resolvePage(pathname) {
  const path = (pathname || "/").replace(/\/+$/, "") || "/";
  // Public verify links and email-confirmation links are handled by the home page.
  if (readVerifyRoute(path) || path === "/auth/confirm") return "home";
  return PAGE_PATHS[path] ?? "notFound";
}
