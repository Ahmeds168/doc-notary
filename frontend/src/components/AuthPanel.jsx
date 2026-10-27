import { useRef, useState } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
import { supabase } from "../lib/supabase.js";
import "./Panel.css";
import "./AuthPanel.css";

const CAPTCHA_MESSAGES = {
  failed: "We couldn't load the human check. Check your connection or turn off content blockers for this site, then reload the page.",
  expired: "The human check expired. Please complete it again.",
};

/**
 * Email + password sign in / sign up via Supabase Auth.
 *
 * With VITE_TURNSTILE_SITE_KEY set, a Cloudflare Turnstile widget must be completed first and
 * its single-use token is sent as `captchaToken` (Supabase Auth CAPTCHA protection). Without
 * the key (e.g. local dev) there is no widget and Supabase is called without a token.
 */
export function AuthPanel({ reason, initialMode = "signin" }) {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  const [mode, setMode] = useState(initialMode === "signup" ? "signup" : "signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("idle"); // idle | working | sent
  const [error, setError] = useState(null);
  const [captchaToken, setCaptchaToken] = useState(null);
  const [captchaProblem, setCaptchaProblem] = useState(null); // null | "failed" | "expired"
  const turnstileRef = useRef(null);

  if (!supabase) {
    return (
      <p className="panel__error">
        Sign-in isn't configured for this deployment (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
      </p>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setStatus("working");
    setError(null);
    const options = siteKey ? { captchaToken } : undefined;
    let result;
    try {
      result =
        mode === "signin"
          ? await supabase.auth.signInWithPassword({ email, password, options })
          : await supabase.auth.signUp({ email, password, options });
    } catch {
      result = { data: null, error: { message: "Couldn't reach the sign-in service. Please try again." } };
    } finally {
      // Tokens are single-use: always get a fresh one for the next attempt.
      if (siteKey) {
        setCaptchaToken(null);
        turnstileRef.current?.reset();
      }
    }
    const { data, error: authError } = result;
    if (authError) {
      setError(authError.message);
      setStatus("idle");
      return;
    }
    // With email confirmation enabled, sign-up returns no session until the link is clicked.
    setStatus(mode === "signup" && !data.session ? "sent" : "idle");
  };

  return (
    <form className="auth-panel" onSubmit={submit}>
      <p className="auth-panel__reason">{reason}</p>
      <div className="panel__mode-toggle">
        <button type="button" className={mode === "signin" ? "is-active" : ""} onClick={() => setMode("signin")}>
          Sign in
        </button>
        <button type="button" className={mode === "signup" ? "is-active" : ""} onClick={() => setMode("signup")}>
          Create account
        </button>
      </div>
      <label className="auth-panel__field">
        <span>Email</span>
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="auth-panel__field">
        <span>Password</span>
        <input
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {siteKey && (
        <div className="auth-panel__captcha">
          {/* Hidden (not unmounted) when it failed to load, so no empty gap; it reappears if it recovers. */}
          <Turnstile
            hidden={captchaProblem === "failed"}
            ref={turnstileRef}
            siteKey={siteKey}
            options={{ theme: "dark", size: "flexible" }}
            scriptOptions={{ onError: () => setCaptchaProblem("failed") }}
            onSuccess={(token) => {
              setCaptchaToken(token);
              setCaptchaProblem(null);
            }}
            onExpire={() => {
              setCaptchaToken(null);
              setCaptchaProblem("expired");
            }}
            onTimeout={() => {
              setCaptchaToken(null);
              setCaptchaProblem("expired");
            }}
            onError={() => {
              setCaptchaToken(null);
              setCaptchaProblem("failed");
            }}
          />
          {captchaProblem && (
            <p className="panel__error" role="alert">
              {CAPTCHA_MESSAGES[captchaProblem]}
            </p>
          )}
        </div>
      )}
      {mode === "signup" && (
        <p className="auth-panel__consent">
          By creating an account you agree to the <a href="/terms">Terms of Service</a> and{" "}
          <a href="/privacy">Privacy Policy</a>.
        </p>
      )}
      {error && <p className="panel__error">{error}</p>}
      {status === "sent" && <p className="auth-panel__note">Check your inbox to confirm your email, then sign in.</p>}
      <button
        className="panel__submit"
        type="submit"
        disabled={status === "working" || (Boolean(siteKey) && !captchaToken)}
      >
        {status === "working" ? "One moment…" : mode === "signin" ? "Sign in" : "Create free account"}
      </button>
    </form>
  );
}
