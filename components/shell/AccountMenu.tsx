"use client";

import { signOut } from "firebase/auth";
import {
  ArrowLeftRight,
  ArrowUpRight,
  ChartNoAxesColumn,
  LayoutGrid,
  LogOut,
  Monitor,
  Moon,
  Sun,
  SunMoon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase/client";
import { applyTheme, readTheme, type ThemeChoice } from "@/lib/ui/theme";
import { formatTokens, useBalance } from "./BalanceContext";

const THEMES: { id: ThemeChoice; label: string; icon: React.ReactNode }[] = [
  { id: "system", label: "System", icon: <Monitor aria-hidden size={15} /> },
  { id: "light", label: "Light", icon: <Sun aria-hidden size={15} /> },
  { id: "dark", label: "Dark", icon: <Moon aria-hidden size={15} /> },
];

/** The PeakPick site, which shares the Sebtember login and wallet. */
const PEAKPICK_URL = "https://peakpick.ai";

const ITEM =
  "flex h-9 w-full items-center gap-2.5 rounded-chip px-2.5 text-left text-[15px] hover:bg-fill1";

/** A menu row that opens another site in a new tab. */
function OutLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <a role="menuitem" href={href} target="_blank" rel="noopener" className={ITEM}>
      {icon}
      <span className="flex-1">{children}</span>
      <ArrowUpRight aria-hidden size={14} className="text-ink2" />
    </a>
  );
}

/** A small lettered tile standing for another product. */
function AppTile({ letter, className }: { letter: string; className: string }) {
  return (
    <span
      aria-hidden
      className={`flex size-5 shrink-0 items-center justify-center rounded-[6px] text-[11px] font-bold text-white ${className}`}
    >
      {letter}
    </span>
  );
}

/** The account button at the foot of the sidebar: balance, then four groups — the sibling
 *  sites; All agents and Change wallet; Appearance; Sign out.
 *  `compact` is the hidden sidebar's rail: the avatar alone, the menu opening beside it. */
export function AccountMenu({
  email,
  sebtemberUrl,
  compact = false,
}: {
  email: string | null;
  sebtemberUrl: string | null;
  compact?: boolean;
}) {
  const { balance } = useBalance();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setTheme(readTheme()), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOutBoth() {
    await fetch("/api/session", { method: "DELETE" });
    await signOut(auth).catch(() => {});
    router.replace("/");
    router.refresh();
  }

  const line =
    balance.state === "loading"
      ? "Reading balance…"
      : balance.state === "error"
        ? "Balance unavailable"
        : `${formatTokens(balance.balance)} tokens`;

  return (
    <div ref={box} className="relative">
      {open && (
        <div
          role="menu"
          className={`absolute z-50 rounded-control bg-raised p-1.5 shadow-pop ${
            compact ? "bottom-0 left-full ml-2 w-64" : "right-0 bottom-full left-0 mb-2"
          }`}
        >
          <div className="px-2.5 pt-1.5 pb-2.5">
            <p className="truncate text-[13px] text-ink2">{email ?? "Signed in"}</p>
            <p className="mt-1 text-[17px] font-bold">{line}</p>
            {balance.state === "ready" && (
              <p className="text-[13px] text-ink2">
                {balance.source === "personal" ? "Personal wallet" : "Shared wallet"} on Sebtember
              </p>
            )}
          </div>
          {sebtemberUrl && (
            <OutLink
              href={sebtemberUrl}
              icon={<AppTile letter="S" className="bg-[#16152E] dark:bg-[#3A3A52]" />}
            >
              Open sebtember.app
            </OutLink>
          )}
          <OutLink href={PEAKPICK_URL} icon={<AppTile letter="P" className="bg-[#2F7D46]" />}>
            Open peakpick.ai
          </OutLink>
          <div className="my-1 h-px bg-hair" />
          <Link role="menuitem" href="/agents" onClick={() => setOpen(false)} className={ITEM}>
            <LayoutGrid aria-hidden size={16} className="text-ink2" />
            All agents
          </Link>
          <Link role="menuitem" href="/usage" onClick={() => setOpen(false)} className={ITEM}>
            <ChartNoAxesColumn aria-hidden size={16} className="text-ink2" />
            Usage
          </Link>
          {sebtemberUrl && (
            <OutLink
              href={new URL("/usage", sebtemberUrl).toString()}
              icon={<ArrowLeftRight aria-hidden size={16} className="text-ink2" />}
            >
              Change wallet
            </OutLink>
          )}
          <div className="my-1 h-px bg-hair" />
          <p className="flex items-center gap-2.5 px-2.5 pt-1 pb-1.5 text-[15px]">
            <SunMoon aria-hidden size={16} className="text-ink2" />
            Appearance
          </p>
          <div className="mx-1 mb-1 grid grid-cols-3 gap-1 rounded-chip bg-fill1 p-0.5">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitemradio"
                aria-checked={theme === t.id}
                onClick={() => {
                  applyTheme(t.id);
                  setTheme(t.id);
                }}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-[6px] text-[13px] font-semibold ${
                  theme === t.id ? "bg-raised text-ink shadow-card" : "text-ink2"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          <div className="my-1 h-px bg-hair" />
          <button type="button" role="menuitem" onClick={signOutBoth} className={ITEM}>
            <LogOut aria-hidden size={16} className="text-ink2" />
            Sign out
          </button>
        </div>
      )}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={compact ? "Account" : undefined}
        title={compact ? `${email ?? "Account"} · ${line}` : undefined}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2.5 rounded-control p-2 text-left hover:bg-fill1 ${compact ? "" : "w-full"}`}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-bold text-page">
          {(email ?? "?").slice(0, 1).toUpperCase()}
        </span>
        {!compact && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold">{email ?? "Account"}</span>
            <span className="block truncate text-[13px] text-ink2">{line}</span>
          </span>
        )}
      </button>
    </div>
  );
}
