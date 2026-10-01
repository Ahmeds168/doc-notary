import { useEffect, useState } from "react";
import { Header } from "./components/Header.jsx";
import { Hero } from "./components/Hero.jsx";
import { AppCard } from "./components/AppCard.jsx";
import { Ledger } from "./components/Ledger.jsx";
import { WakingBanner } from "./components/WakingBanner.jsx";
import { getStats, getMe } from "./lib/api.js";
import { useSession } from "./lib/useSession.js";
import "./styles/tokens.css";
import "./App.css";

export default function App() {
  const { session } = useSession();
  const [totalNotarized, setTotalNotarized] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isWaking, setIsWaking] = useState(false);
  const [accountState, setAccountState] = useState({ token: null, account: null });

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

  const token = session?.access_token ?? null;
  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    getMe(token)
      .then((me) => active && setAccountState({ token, account: me }))
      .catch(() => active && setAccountState({ token, account: null }));
    return () => {
      active = false;
    };
  }, [token, refreshKey]);

  const account = token && accountState.token === token ? accountState.account : null;

  return (
    <div className="app-shell">
      <Header session={session} plan={account?.plan} />
      {isWaking && <WakingBanner />}
      <Hero totalNotarized={totalNotarized} />
      <AppCard session={session} account={account} onNotarized={() => setRefreshKey((k) => k + 1)} />
      <section className="app-card ledger-section">
        <Ledger session={session} account={account} refreshKey={refreshKey} />
      </section>
      <footer className="site-footer">
        <span>Document Notary — an on-chain proof-of-existence tool</span>
        <span className="mono">Vercel · Render · Supabase · Cloudflare R2 · Sepolia</span>
      </footer>
    </div>
  );
}
