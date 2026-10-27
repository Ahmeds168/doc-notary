import { BUSINESS, REFUND_WINDOW } from "../../lib/site.js";
import { BetaNotice } from "./BetaNotice.jsx";
import { LegalPage } from "./LegalPage.jsx";

export function RefundPage() {
  return (
    <LegalPage title="Refund Policy">
      <p>
        This policy covers Doc Notary's paid plans. The Free plan has no charges. Paid plans are launching shortly.
      </p>

      <BetaNotice />

      <h2>Who processes payments</h2>
      <p>
        Payments are processed by <strong>Kelviq</strong>, our merchant of record. Kelviq is the seller on your
        receipt, and handles payment, tax and refunds on our behalf.
      </p>

      <h2>Refunds</h2>
      <p>
        You can request a full refund within <strong>{REFUND_WINDOW}</strong> of your first payment or of any renewal.
      </p>

      <h2>How to request a refund</h2>
      <ul>
        <li>
          Email <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> from your account's email address, with the
          date of the charge, or
        </li>
        <li>use the refund or support option in your Kelviq receipt or customer portal.</li>
      </ul>
      <p>Refunds are paid back to the original payment method through Kelviq.</p>

      <h2>Proofs after a refund</h2>
      <p>
        Proofs already recorded stay on the blockchain after a refund. No one can remove them, and you can still
        verify them.
      </p>

      <h2>Cancelling</h2>
      <p>
        Cancelling stops future renewals. You keep Standard access until the end of the period you've already paid for,
        then your account moves to the Free plan.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about billing: <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>.
      </p>
    </LegalPage>
  );
}
