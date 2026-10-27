"use client";

import { FirebaseError } from "firebase/app";
import {
  getRedirectResult,
  onIdTokenChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import { useEffect, useState } from "react";
import { KnowledgePanel } from "@/components/KnowledgePanel";
import { auth, googleProvider } from "@/lib/firebase/client";

type Balance = { source: string; balance: number; minimum: number } | { error: string };

export function AccountPanel() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [busy, setBusy] = useState(false);
  // The sign-in failure, shown on the page: a silent failure cannot be diagnosed.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Consumes the return trip of the redirect fallback below.
    getRedirectResult(auth).catch((err) => setError(describe(err)));
    return onIdTokenChanged(auth, async (next) => {
      setUser(next);
      setBalance(null);
      if (!next) return;
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken: await next.getIdToken() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const reason = body.error ?? `session_refused_${res.status}`;
        return setBalance({ error: body.detail ? `${reason}: ${body.detail}` : reason });
      }
      const b = await fetch("/api/balance");
      setBalance(await b.json());
    });
  }, []);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      // A blocked popup falls back to a full-page redirect, as sebtember.app does.
      if (err instanceof FirebaseError && err.code === "auth/popup-blocked") {
        await signInWithRedirect(auth, googleProvider).catch((e) => setError(describe(e)));
        return;
      }
      if (!(err instanceof FirebaseError && err.code === "auth/popup-closed-by-user")) {
        setError(describe(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function signOutBoth() {
    await fetch("/api/session", { method: "DELETE" });
    await signOut(auth);
  }

  if (user === undefined) return <p className="text-sm text-muted">Loading…</p>;

  if (!user) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={signIn}
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in with your Sebtember account"}
        </button>
        {error && <p className="text-sm text-red-600">Sign-in failed: {error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border border-line p-4 text-sm">
        <p>
          Signed in as <strong>{user.email}</strong>
        </p>
        <p>
          {balance === null
            ? "Reading your Sebtember balance…"
            : "error" in balance
              ? `Balance unavailable (${balance.error}).`
              : `Balance: ${balance.balance.toLocaleString("en-US")} tokens (${balance.source === "personal" ? "personal" : "shared"} wallet)`}
        </p>
        <button type="button" onClick={signOutBoth} className="text-muted underline">
          Sign out
        </button>
      </div>
      {balance && !("error" in balance) && <KnowledgePanel />}
    </div>
  );
}

function describe(err: unknown): string {
  if (err instanceof FirebaseError) return err.code;
  return err instanceof Error ? err.message : String(err);
}
