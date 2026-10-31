import { BUSINESS } from "../../lib/site.js";
import { LegalPage } from "./LegalPage.jsx";

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains what Doc Notary collects, why, who processes it, and what becomes public. Doc Notary is
        run by {BUSINESS.legalName} ({BUSINESS.country}). We don't sell your data and we don't use
        advertising trackers.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details:</strong> your email address and password, handled by Supabase Auth. Passwords are
          stored by Supabase in hashed form; we never see them.
        </li>
        <li>
          <strong>Files you notarize:</strong> stored privately in Cloudflare R2 so that you can download them and
          generate PDF certificates. Only you can download your files, through short-lived links. If a notarization
          fails before anything is sent to the blockchain, the uploaded file is removed.
        </li>
        <li>
          <strong>File details:</strong> stored in our database (Supabase): the file's SHA-256 hash, its original
          filename, size and type, the transaction details, and which account it belongs to. The original filename is
          private and appears only to you, including on your own PDF certificates.
        </li>
        <li>
          <strong>Technical data:</strong> IP addresses, browser and device details and request information in the
          standard logs of our hosting and authentication providers, and in Vercel Web Analytics (anonymous page-view
          statistics).
        </li>
      </ul>
      <p>
        When you verify a file, it is hashed in your browser and only the hash is sent to us. The file itself never
        leaves your device, and verification doesn't need an account.
      </p>

      <h2>What becomes public on the blockchain</h2>
      <p>
        Notarizing a file writes a record to a public blockchain. <strong>Once written, it can't be edited or deleted
        by us or anyone else.</strong> The record contains:
      </p>
      <ul>
        <li>the file's SHA-256 hash;</li>
        <li>the optional label, only if you enter one;</li>
        <li>the time of the block;</li>
        <li>our relayer wallet address (not your identity or email).</li>
      </ul>
      <p>
        <strong>The file itself and its filename are never put on the blockchain.</strong> A hash doesn't reveal a
        file's contents, but someone who already has a copy of a file can check whether it was notarized. The few
        records created during early testing, before October 2026, used the original filename as their public label.
      </p>

      <h2>Services that process data for us</h2>
      <ul>
        <li>
          <strong>Supabase:</strong> accounts, sign-in and our database.
        </li>
        <li>
          <strong>Cloudflare:</strong> R2 file storage, and Turnstile, which checks in your browser that sign-ins and
          sign-ups come from a person rather than a bot.
        </li>
        <li>
          <strong>Vercel:</strong> hosts the website, and Vercel Web Analytics provides anonymous, cookie-free visit
          statistics.
        </li>
        <li>
          <strong>Render:</strong> hosts our API, which receives uploads, stores them and sends blockchain
          transactions.
        </li>
        <li>
          <strong>Google Fonts:</strong> the website's fonts load from Google's servers, which receive your IP address.
        </li>
        <li>
          <strong>The Ethereum network</strong> (currently the Sepolia test network) and the node provider we use to
          reach it, which receive the public records described above.
        </li>
        <li>
          <strong>Kelviq</strong>, as merchant of record and payment processor for paid plans. Kelviq handles
          payment details; we don't receive your card number.
        </li>
      </ul>
      <p>These providers may process data outside Pakistan.</p>

      <h2>Cookies and local storage</h2>
      <p>
        Doc Notary doesn't use advertising or tracking cookies. When you sign in, the Supabase sign-in library keeps
        your session in your browser's local storage so you stay signed in; signing out removes it. Cloudflare
        Turnstile runs a check in your browser when you sign in or sign up.
      </p>

      <h2>How long we keep data</h2>
      <p>
        We keep your account, stored files and file records until you ask us to delete them or your account is closed.
        Provider logs are kept for the periods those providers set. Records on the blockchain can't be removed.
      </p>

      <h2>Deleting your account and files</h2>
      <p>
        Email <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> from your account's email address to ask us to
        delete your account and stored files, or for a copy of your data. We'll delete your account, your stored files
        and their database records. <strong>On-chain records (hashes, any labels you entered, and timestamps) can't be
        removed</strong>, because no one can edit a public blockchain.
      </p>

      <h2>Changes</h2>
      <p>We'll update the date above when this policy changes, and email account holders about significant changes.</p>

      <h2>Contact</h2>
      <p>
        Questions about privacy: <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>.
      </p>
    </LegalPage>
  );
}
