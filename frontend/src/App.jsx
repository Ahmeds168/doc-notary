import { useEffect, useState } from "react";
import { Header } from "./components/Header.jsx";
import { Hero } from "./components/Hero.jsx";
import { AppCard } from "./components/AppCard.jsx";
import { Ledger } from "./components/Ledger.jsx";
import { getStats } from "./lib/api.js";
import "./styles/tokens.css";
import "./App.css";

export default function App() {
  const [totalNotarized, setTotalNotarized] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    getStats()
      .then((s) => setTotalNotarized(s.totalNotarized))
      .catch(() => setTotalNotarized(null));
  }, [refreshKey]);

  return (
    <div className="app-shell">
      <Header />
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
