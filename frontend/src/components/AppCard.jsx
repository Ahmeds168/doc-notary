import { useState } from "react";
import { NotarizePanel } from "./NotarizePanel.jsx";
import { VerifyPanel } from "./VerifyPanel.jsx";
import { AuthPanel } from "./AuthPanel.jsx";
import "./AppCard.css";

export function AppCard({ session, account, onNotarized }) {
  const [tab, setTab] = useState("notarize");

  return (
    <section className="app-card">
      <div className="app-card__tabs">
        <button
          className={tab === "notarize" ? "is-active" : ""}
          onClick={() => setTab("notarize")}
        >
          Notarize
        </button>
        <button className={tab === "verify" ? "is-active" : ""} onClick={() => setTab("verify")}>
          Verify
        </button>
      </div>

      <div className="app-card__body">
        {tab === "verify" ? (
          <VerifyPanel />
        ) : session ? (
          <NotarizePanel session={session} account={account} onNotarized={onNotarized} />
        ) : (
          <AuthPanel reason="Sign in to notarize. Free accounts include 3 notarizations a month. Verifying a document never requires an account." />
        )}
      </div>
    </section>
  );
}
