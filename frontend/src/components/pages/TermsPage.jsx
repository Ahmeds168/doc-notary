import { BUSINESS } from "../../lib/site.js";
import { PLANS, formatMb } from "../../lib/plans.js";
import { BetaNotice } from "./BetaNotice.jsx";
import { LegalPage } from "./LegalPage.jsx";

export function TermsPage() {
  const { free, standard } = PLANS;
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms apply when you use Doc Notary at doc-notary.com (the "service"). The service is provided by{" "}
        {BUSINESS.legalName}, a {BUSINESS.form} based in {BUSINESS.country} ("we", "us"). By using
        the service you agree to these terms.
      </p>

      <BetaNotice />

      <h2>1. The service</h2>
      <p>When you notarize a file with Doc Notary:</p>
      <ul>
        <li>your file is uploaded and stored privately, so that you can download it and a PDF certificate later;</li>
        <li>
          its SHA-256 fingerprint (a "hash") is recorded on a public blockchain, together with the time of the block
          and, only if you choose to enter one, a short public label;
        </li>
        <li>the transaction is sent and paid for by our own wallet (the "relayer"), so you don't need one.</li>
      </ul>
      <p>
        Anyone can verify a file or hash, without an account. Verification computes the hash in the browser and sends
        only the hash, never the file.
      </p>

      <h2>2. Accounts and who may use the service</h2>
      <p>
        You need an account (email and password) to notarize files. You must be at least 18, or the age of majority
        where you live, and able to agree to these terms. Keep your password secure; you are responsible for activity
        on your account. One person or organization may not create multiple accounts to get around plan limits.
      </p>

      <h2>3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>upload content that is illegal, or that you don't have the right to upload;</li>
        <li>use the service to harass, defraud or harm anyone, or to distribute malware;</li>
        <li>scrape the service or access it in automated ways beyond normal use of the website;</li>
        <li>
          try to get around plan limits, rate limits or the bot check (Cloudflare Turnstile), or interfere with the
          service's security or operation.
        </li>
      </ul>

      <h2>4. Plans, limits and fair use</h2>
      <p>
        The Free plan includes {free.monthlyNotarizations} notarizations per month with files up to{" "}
        {formatMb(free.maxFileSizeBytes)}. The Standard plan includes {standard.monthlyNotarizations} notarizations
        per month with files up to {formatMb(standard.maxFileSizeBytes)}, notarization history and email support.
        Current prices are on the <a href="/pricing">Pricing page</a>. Monthly limits reset at the start of each
        calendar month (UTC), and failed attempts don't count. To keep the service reliable and affordable, we may
        apply short-term rate limits and a daily cap on network fees, which can temporarily pause new notarizations.
        Verification is not limited by plan.
      </p>

      <h2>5. What a proof shows, and what it doesn't</h2>
      <p>
        A Doc Notary proof shows that <strong>a file with this exact SHA-256 hash was recorded at the time of a
        specific block</strong> on the blockchain network named on your certificate. A copy of a file that produces
        the same hash is byte-for-byte identical to the one recorded.
      </p>
      <p>A proof does not show:</p>
      <ul>
        <li>who created or owns the file (authorship or ownership);</li>
        <li>the identity of the person who notarized it: the blockchain records our relayer wallet, not you;</li>
        <li>that nobody had the file earlier;</li>
        <li>anything a legal notary would certify. Doc Notary is not a legal notarization service;</li>
        <li>legal advice of any kind.</li>
      </ul>

      <h2>6. Your files and your responsibility</h2>
      <p>
        You keep all rights to the files you upload. You give us permission to store and process them only to provide
        the service (storing the file, computing its hash, recording the hash, and producing downloads and
        certificates). You are responsible for the files you upload, and for any label you choose to publish. Labels
        are public on the blockchain and can't be removed later, so don't put personal or confidential information in
        them.
      </p>

      <h2>7. Availability</h2>
      <p>
        We work to keep Doc Notary running, but we don't guarantee any level of uptime. The service relies on
        third-party providers and on a blockchain network we don't control, and it may be slow, interrupted or
        unavailable. The website may take up to a minute to respond after a period of inactivity.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        The service is provided "as is" and "as available". To the extent the law allows, we are not liable for
        indirect or consequential losses, lost profits or lost data, or for losses caused by blockchain networks,
        third-party providers or events outside our control. Our total liability for any claim related to the service
        is limited to the amount you paid us in the 12 months before the claim, or US$10 if you haven't paid
        anything. Nothing in these terms limits liability that can't be limited by law.
      </p>

      <h2>9. Termination</h2>
      <p>
        You can stop using the service at any time and ask us to close your account by emailing{" "}
        <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>. We may suspend or close accounts that break these
        terms. When an account is closed we delete its stored files and records as described in the{" "}
        <a href="/privacy">Privacy Policy</a>; hashes, labels and timestamps already recorded on the blockchain can't
        be removed.
      </p>

      <h2>10. Changes to these terms</h2>
      <p>
        We may update these terms. We'll change the "Last updated" date above and, for significant changes, tell
        account holders by email. If you keep using the service after a change, the updated terms apply.
      </p>

      <h2>11. Governing law</h2>
      <p>These terms are governed by the laws of Pakistan.</p>

      <h2>12. Contact</h2>
      <p>
        {BUSINESS.legalName}, {BUSINESS.country}.{" "}
        Email: <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>.
      </p>
    </LegalPage>
  );
}
