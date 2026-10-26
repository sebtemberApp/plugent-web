"use client";

import { onIdTokenChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { useEffect, useState } from "react";
import { auth, googleProvider } from "@/lib/firebase/client";

type Balance = { source: string; balance: number; minimum: number } | { error: string };

export function AccountPanel() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      onIdTokenChanged(auth, async (next) => {
        setUser(next);
        setBalance(null);
        if (!next) return;
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idToken: await next.getIdToken() }),
        });
        if (!res.ok) return setBalance({ error: "session_refused" });
        const b = await fetch("/api/balance");
        setBalance(await b.json());
      }),
    [],
  );

  async function signIn() {
    setBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
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
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? "Signing in…" : "Sign in with your Sebtember account"}
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-line p-4 text-sm">
      <p>
        Signed in as <strong>{user.email}</strong>
      </p>
      <p>
        {balance === null
          ? "Reading your Sebtember balance…"
          : "error" in balance
            ? `Balance unavailable (${balance.error}).`
            : `Balance: ${balance.balance.toLocaleString("en-US")} tokens (${balance.source} wallet)`}
      </p>
      <button type="button" onClick={signOutBoth} className="text-muted underline">
        Sign out
      </button>
    </div>
  );
}
