import React, { useState, useEffect } from "react";
import { supabase, isConfigured, emailAllowed, ALLOWED_EMAILS } from "./supabase.js";

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!isConfigured) return <SetupNeeded />;
  if (loading) return <Splash msg="Loading…" />;

  if (!session) return <SignIn />;

  // Signed in — enforce the email allow-list.
  const email = session.user?.email;
  if (!emailAllowed(email)) {
    return (
      <Splash
        msg="This account isn't on the access list."
        sub={`Signed in as ${email}. Ask the owner to add you, or sign out.`}
        action={{ label: "Sign out", onClick: () => supabase.auth.signOut() }}
      />
    );
  }

  return (
    <>
      <TopBar email={email} />
      {children}
    </>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setErr("");
    if (!email.trim()) return;
    if (!emailAllowed(email)) {
      setErr("That email isn't on the access list for this tool.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-kicker">The ST6 Ledger · Private</div>
        <h1 className="auth-title">Deal <em>Analyser</em></h1>
        {sent ? (
          <p className="auth-msg">
            Check your inbox — we've sent a sign-in link to <strong>{email}</strong>.
            Open it on this device to continue.
          </p>
        ) : (
          <>
            <p className="auth-msg">
              Enter your email and we'll send a one-tap sign-in link. No password.
            </p>
            <input
              className="auth-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            {err && <div className="auth-err">{err}</div>}
            <button className="btn auth-btn" onClick={send} disabled={busy}>
              {busy ? "Sending…" : "Send sign-in link"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function TopBar({ email }) {
  return (
    <div className="topbar">
      <span className="topbar-user">{email}</span>
      <button className="topbar-signout" onClick={() => supabase.auth.signOut()}>
        Sign out
      </button>
    </div>
  );
}

function Splash({ msg, sub, action }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">Deal <em>Analyser</em></h1>
        <p className="auth-msg">{msg}</p>
        {sub && <p className="auth-msg" style={{ fontSize: 13, opacity: 0.7 }}>{sub}</p>}
        {action && (
          <button className="btn auth-btn" onClick={action.onClick}>{action.label}</button>
        )}
      </div>
    </div>
  );
}

function SetupNeeded() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-kicker">Setup required</div>
        <h1 className="auth-title">Deal <em>Analyser</em></h1>
        <p className="auth-msg">
          Supabase isn't connected yet. Add <code>VITE_SUPABASE_URL</code> and{" "}
          <code>VITE_SUPABASE_ANON_KEY</code> to your environment (a local{" "}
          <code>.env</code> file, or the Cloudflare Pages environment variables),
          then rebuild. See <code>README.md</code> for the full steps.
        </p>
      </div>
    </div>
  );
}
