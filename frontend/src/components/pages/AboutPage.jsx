import { BUSINESS } from "../../lib/site.js";
import "./Page.css";

export function AboutPage() {
  return (
    <main className="page">
      <p className="page__eyebrow">About &amp; Contact</p>
      <h1>About Doc Notary</h1>

      <h2>Who runs it</h2>
      <p>
        Doc Notary is run by {BUSINESS.operator}, a software developer in {BUSINESS.city}, {BUSINESS.country}, who
        operates it as a {BUSINESS.form}. More of {BUSINESS.operator}'s work is at{" "}
        <a href={BUSINESS.portfolio} target="_blank" rel="noreferrer">
          ahmedalishah.vercel.app
        </a>
        .
      </p>

      <h2>What it does</h2>
      <p>
        Doc Notary records a file's SHA-256 fingerprint, together with a timestamp, on a public blockchain. Anyone can
        later check a copy of the file in their own browser: if it produces the same fingerprint, it is byte-for-byte
        identical to what was recorded, and it existed no later than the recorded time. The file itself is never put
        on the blockchain; your original is stored privately so you can download it and a PDF certificate later.
      </p>

      <h2>Who it's for</h2>
      <ul>
        <li>Journals and researchers who want to show when a manuscript, dataset or draft existed.</li>
        <li>Freelancers and creators who want evidence of when they had their work in hand.</li>
      </ul>
      <p>
        A proof shows existence at a point in time. It does not prove authorship and is not a legal notarization. See
        the <a href="/terms">Terms of Service</a> for details.
      </p>

      <h2>Contact</h2>
      <ul>
        <li>
          Email: <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>
        </li>
        <li>
          Based in: {BUSINESS.city}, {BUSINESS.region}, {BUSINESS.country}
        </li>
        <li>We aim to reply {BUSINESS.replyTime}.</li>
      </ul>
    </main>
  );
}
