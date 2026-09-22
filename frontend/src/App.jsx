import { useEffect, useState } from "react";
import { Header } from "./components/Header.jsx";
import { Hero } from "./components/Hero.jsx";
import { AppCard } from "./components/AppCard.jsx";
import { Ledger } from "./components/Ledger.jsx";
import { WakingBanner } from "./components/WakingBanner.jsx";
import { getStats } from "./lib/api.js";
import "./styles/tokens.css";
import "./App.css";

export default function App() {
  const [totalNotarized, setTotalNotarized] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isWaking, setIsWaking] = useState(false);

  useEffect(() => {
    let settled = false;
    const wakingTimer = setTimeout(() => {
      if (!settled) setIsWaking(true);
    }, 2500);

    getStats()
      .then((s) => setTotalNotarized(s.totalNotarized))
      .catch(() => setTotalNotarized(null))
      .finally(() => {
        settled = true;
        clearTimeout(wakingTimer);
        setIsWaking(false);
      });

    return () => clearTimeout(wakingTimer);
  }, [refreshKey]);

  return (
    <div className="app-shell">
      <Header />
      {isWaking && <WakingBanner />}
      <Hero totalNotarized={totalNotarized} />
      <AppCard onNotarized={() => setRefreshKey((k) => k + 1)} />
      <section className="app-card ledger-section">
        <Ledger refreshKey={refreshKey} />
      </section>
      <footer className="site-footer">
        <span>Document Notary — an on-chain proof-of-existence tool</span>
        <span className="mono">Vercel · Render · Supabase · Cloudflare R2 · Sepolia</span>
      </footer>
    </div>
  );
}