/**
 * Business details. Change them here only.
 * Public pages (footer, About) show only the trading name and country; the operator's name
 * appears only in the legal pages (Terms, Privacy), where the contracting party must be named.
 * When Doc Notary is registered as a business, put the business name in legalName.
 */
export const BUSINESS = Object.freeze({
  operator: "Syed Ahmed Ali Shah",
  tradingName: "Doc Notary",
  legalName: "Syed Ahmed Ali Shah, trading as Doc Notary",
  form: "sole proprietor",
  country: "Pakistan",
  email: "support@doc-notary.com",
  replyTime: "within 2 business days",
  siteUrl: "https://www.doc-notary.com",
});

/** Shown as "Last updated" on Terms, Privacy and Refund Policy. */
export const LEGAL_EFFECTIVE_DATE = "31 October 2026";

export const REFUND_WINDOW = "14 days";

export const BETA_NOTICE =
  "Doc Notary is in beta. Proofs are currently recorded on the Ethereum Sepolia test network, which may be reset or retired. We plan to move to a production network. When we do, we will re-record the proofs of paying customers on the new network at no extra cost. If Sepolia stops before that, affected paying customers can request a refund for the affected period.";

export const FOOTER_LINKS = Object.freeze([
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About & Contact" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refund-policy", label: "Refund Policy" },
]);
