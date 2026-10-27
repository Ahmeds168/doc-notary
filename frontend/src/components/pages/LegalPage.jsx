import { BUSINESS, LEGAL_EFFECTIVE_DATE } from "../../lib/site.js";
import "./Page.css";

/** Shared layout for Terms, Privacy and Refund Policy. */
export function LegalPage({ title, children }) {
  return (
    <main className="page">
      <p className="page__eyebrow">Doc Notary</p>
      <h1>{title}</h1>
      <p className="page__updated">Last updated: {LEGAL_EFFECTIVE_DATE}</p>
      {children}
      <p className="page__closing">
        These terms are provided in good faith for a small independent service. Contact{" "}
        <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> with any questions.
      </p>
    </main>
  );
}
