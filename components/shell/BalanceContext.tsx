"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Balance =
  | { state: "loading" }
  | { state: "ready"; source: string; balance: number; minimum: number }
  | { state: "error"; error: string };

interface BalanceApi {
  balance: Balance;
  /** After a run: the wallet's balance as sebtember reported it with the charge. */
  spent: (balanceAfter: number) => void;
  refresh: () => void;
}

const Ctx = createContext<BalanceApi | null>(null);

/** The user's Sebtember wallet, read once per page load and updated by each run's charge. */
export function BalanceProvider({ children }: { children: React.ReactNode }) {
  const [balance, setBalance] = useState<Balance>({ state: "loading" });

  const refresh = useCallback(() => {
    fetch("/api/balance")
      .then(async (r) => {
        const data = await r.json().catch(() => ({ error: `http_${r.status}` }));
        setBalance(
          r.ok
            ? { state: "ready", ...data }
            : { state: "error", error: String(data.error ?? r.status) },
        );
      })
      .catch(() => setBalance({ state: "error", error: "unreachable" }));
  }, []);

  useEffect(() => refresh(), [refresh]);

  const spent = useCallback((balanceAfter: number) => {
    setBalance((b) => (b.state === "ready" ? { ...b, balance: balanceAfter } : b));
  }, []);

  return <Ctx.Provider value={{ balance, spent, refresh }}>{children}</Ctx.Provider>;
}

export function useBalance(): BalanceApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useBalance outside BalanceProvider");
  return api;
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}
