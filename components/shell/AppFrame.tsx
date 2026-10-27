"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { RunSummary } from "@/lib/runs";
import { BalanceProvider } from "./BalanceContext";
import { Logo } from "./Logo";
import { Sidebar } from "./Sidebar";

/**
 * The signed-in frame: a 264px sidebar beside the page from 900px up; below that a top
 * bar whose menu button slides the same sidebar in over the page.
 */
export function AppFrame({
  email,
  topUpUrl,
  runs,
  children,
}: {
  email: string | null;
  topUpUrl: string | null;
  /** null when the history could not be read. */
  runs: RunSummary[] | null;
  children: React.ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);
  const path = usePathname();

  // A navigation closes the drawer; so does Escape.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes on every path change
  useEffect(() => setDrawer(false), [path]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

  return (
    <BalanceProvider>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 border-hair border-r-[0.5px] min-[900px]:block">
          <Sidebar email={email} topUpUrl={topUpUrl} runs={runs} />
        </aside>

        {drawer && (
          <div className="fixed inset-0 z-40 min-[900px]:hidden">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setDrawer(false)}
              className="absolute inset-0 bg-black/35"
            />
            <aside className="absolute inset-y-0 left-0 w-[min(300px,85vw)] shadow-pop">
              <Sidebar
                email={email}
                topUpUrl={topUpUrl}
                runs={runs}
                onNavigate={() => setDrawer(false)}
              />
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setDrawer(false)}
                className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-full bg-fill2"
              >
                <X aria-hidden size={18} />
              </button>
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-hair border-b-[0.5px] bg-page/90 px-4 backdrop-blur min-[900px]:hidden">
            <button
              type="button"
              aria-label="Open menu"
              aria-expanded={drawer}
              onClick={() => setDrawer(true)}
              className="-ml-1 flex size-11 items-center justify-center rounded-full hover:bg-fill1"
            >
              <Menu aria-hidden size={22} />
            </button>
            <Link href="/home">
              <Logo className="h-5" />
            </Link>
          </header>
          {children}
        </div>
      </div>
    </BalanceProvider>
  );
}
