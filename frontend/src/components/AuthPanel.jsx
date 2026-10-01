import { useState } from "react";
import { supabase } from "../lib/supabase.js";
import "./Panel.css";
import "./AuthPanel.css";

/** Email + password sign in / sign up via Supabase Auth. */
export function AuthPanel({ reason }) {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("idle"); // idle | working | sent
  const [error, setError] = useState(null);

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
    const { data, error: authError } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
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
      {error && <p className="panel__error">{error}</p>}
      {status === "sent" && <p className="auth-panel__note">Check your inbox to confirm your email, then sign in.</p>}
      <button className="panel__submit" type="submit" disabled={status === "working"}>
        {status === "working" ? "One moment…" : mode === "signin" ? "Sign in" : "Create free account"}
      </button>
    </form>
  );
}
