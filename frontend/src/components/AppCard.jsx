import { useState } from "react";
import { NotarizePanel } from "./NotarizePanel.jsx";
import { VerifyPanel } from "./VerifyPanel.jsx";
import "./AppCard.css";

export function AppCard({ onNotarized }) {
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
        {tab === "notarize" ? <NotarizePanel onNotarized={onNotarized} /> : <VerifyPanel />}
      </div>
    </section>
  );
}
