import { useEffect, useState } from "react";
import { Header } from "./components/Header.jsx";
import { Hero } from "./components/Hero.jsx";
import { AppCard } from "./components/AppCard.jsx";
import { Ledger } from "./components/Ledger.jsx";
import { WakingBanner } from "./components/WakingBanner.jsx";
import { ConfirmBanner } from "./components/ConfirmBanner.jsx";
import { getStats, getMe, syncBilling } from "./lib/api.js";
import { readUpgradeIntent, readCheckoutReturn, clearBillingParams, goToCheckout, billingErrorMessage } from "./lib/billing.js";
import { CheckoutBanner } from "./components/CheckoutBanner.jsx";
import { useSession } from "./lib/useSession.js";
import { supabase } from "./lib/supabase.js";
import { confirmEmailFromUrl } from "./lib/confirmEmail.js";
import { readVerifyRoute, resolvePage, PAGE_META } from "./lib/routes.js";
import { usePageMeta } from "./lib/usePageMeta.js";
import { Footer } from "./components/Footer.jsx";
import { PricingPage } from "./components/pages/PricingPage.jsx";
import { AboutPage } from "./components/pages/AboutPage.jsx";
import { TermsPage } from "./components/pages/TermsPage.jsx";
import { PrivacyPage } from "./components/pages/PrivacyPage.jsx";
import { RefundPage } from "./components/pages/RefundPage.jsx";
import { NotFoundPage } from "./components/pages/NotFoundPage.jsx";
import "./styles/tokens.css";
import "./App.css";

const PAGES = {
  pricing: PricingPage,
  about: AboutPage,
  terms: TermsPage,
  privacy: PrivacyPage,
  refund: RefundPage,
  notFound: NotFoundPage,
};

/** Picks the page from the URL once (internal links are full page loads). */
export default function App() {
  const [page] = useState(() => resolvePage(window.location.pathname));
  usePageMeta({ ...PAGE_META[page], noindex: page === "notFound" });

  if (page === "home") return <HomePage />;
  const Page = PAGES[page];
  return <PageShell><Page /></PageShell>;
}

function PageShell({ children }) {
  const { session } = useSession();
  return (
    <div className="app-shell">
      <Header session={session} />
      {children}
      <Footer />
    </div>
  );
}

function HomePage() {
  const { session } = useSession();
  const [totalNotarized, setTotalNotarized] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isWaking, setIsWaking] = useState(false);
  const [accountState, setAccountState] = useState({ token: null, account: null });
  const [confirmResult, setConfirmResult] = useState(null);
  // Public /verify/:hash links open the Verify tab pre-filled (read once on load).
  const [verifyRoute] = useState(() => readVerifyRoute(window.location.pathname));
  // "Start free" on the Pricing page links to /?signup=1.
  const [authMode] = useState(() => (new URLSearchParams(window.location.search).has("signup") ? "signup" : "signin"));

  // Handle /auth/confirm?token_hash=…&type=email links from the signup email.
  useEffect(() => {
    let active = true;
    confirmEmailFromUrl(supabase).then((result) => active && setConfirmResult(result));
    return () => {
      active = false;
    };
  }, []);

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

  // Billing hand-offs (each runs once per page load):
  //  - /?upgrade=monthly|yearly from the Pricing page: continue to checkout after sign-in.
  //  - /?checkout=success from Kelviq: re-check the subscription and say how it went.
  const [upgradeIntent] = useState(() => readUpgradeIntent());
  const [checkoutReturn] = useState(() => readCheckoutReturn());
  const [billingNotice, setBillingNotice] = useState(() => (checkoutReturn ? "checking" : null));
  const [billingError, setBillingError] = useState(null);

  useEffect(() => {
    if (!token || !upgradeIntent) return;
    clearBillingParams();
    setBillingNotice("redirecting");
    goToCheckout(upgradeIntent, token).catch((err) => {
      setBillingNotice("error");
      setBillingError(billingErrorMessage(err));
    });
  }, [token, upgradeIntent]);

  useEffect(() => {
    if (!token || !checkoutReturn) return;
    clearBillingParams();
    let active = true;
    syncBilling(token)
      .then(({ plan }) => active && setBillingNotice(plan === "standard" ? "upgraded" : "pending"))
      .catch(() => active && setBillingNotice("pending"))
      .finally(() => active && setRefreshKey((k) => k + 1));
    return () => {
      active = false;
    };
  }, [token, checkoutReturn]);

  return (
    <div className="app-shell">
      <Header session={session} plan={account?.plan} />
      {confirmResult && <ConfirmBanner result={confirmResult} onDismiss={() => setConfirmResult(null)} />}
      {billingNotice && (
        <CheckoutBanner state={billingNotice} error={billingError} onDismiss={() => setBillingNotice(null)} />
      )}
      {isWaking && <WakingBanner />}
      <Hero totalNotarized={totalNotarized} />
      <AppCard
        session={session}
        account={account}
        verifyRoute={verifyRoute}
        authMode={authMode}
        onNotarized={() => setRefreshKey((k) => k + 1)}
      />
      <section className="app-card ledger-section">
        <Ledger session={session} account={account} refreshKey={refreshKey} />
      </section>
      <Footer />
    </div>
  );
}
