"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type Balance =
  | { state: "loading" }
  | { state: "ready"; source: string; balance: number; minimum: number }
  | { state: "error"; error: string };

interface BalanceApi {
  balance: Balance;
  /** After a run: the wallet's balance as sebtember reported it with the charge. */
  spent: (balanceAfter: number) => void;
  refresh: () => void;
  /** Sebtember's Usage page, where the wallet is topped up; null when the origin is unknown. */
  topUpUrl: string | null;
}

const Ctx = createContext<BalanceApi | null>(null);

/** The user's Sebtember wallet, read once per page load and updated by each run's charge. */
export function BalanceProvider({
  children,
  sebtemberUrl = null,
}: {
  children: React.ReactNode;
  sebtemberUrl?: string | null;
}) {
  const [balance, setBalance] = useState<Balance>({ state: "loading" });
  const balanceRef = useRef(balance);
  balanceRef.current = balance;

  // ⚠️ A read that started before a charge must not overwrite the balance the charge reported:
  // `spent` bumps this, and a read whose number is behind it is dropped.
  const version = useRef(0);
  const refresh = useCallback(() => {
    const started = version.current;
    fetch("/api/balance")
      .then(async (r) => {
        const data = await r.json().catch(() => ({ error: `http_${r.status}` }));
        if (version.current !== started) return;
        setBalance(
          r.ok
            ? { state: "ready", ...data }
            : { state: "error", error: String(data.error ?? r.status) },
        );
      })
      .catch(() => setBalance({ state: "error", error: "unreachable" }));
  }, []);

  useEffect(() => refresh(), [refresh]);

  const spent = useCallback(
    (balanceAfter: number) => {
      version.current += 1;
      if (balanceRef.current.state === "loading") {
        // The read in flight predates this charge (and is now dropped): read again.
        refresh();
        return;
      }
      setBalance((b) => (b.state === "ready" ? { ...b, balance: balanceAfter } : b));
    },
    [refresh],
  );

  const topUpUrl = sebtemberUrl ? new URL("/usage", sebtemberUrl).toString() : null;
  return <Ctx.Provider value={{ balance, spent, refresh, topUpUrl }}>{children}</Ctx.Provider>;
}

export function useBalance(): BalanceApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useBalance outside BalanceProvider");
  return api;
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}
