"use client";

import { signOut } from "firebase/auth";
import {
  ArrowLeftRight,
  ArrowUpRight,
  ChartNoAxesColumn,
  Check,
  ChevronLeft,
  ChevronRight,
  Languages,
  LayoutGrid,
  LogOut,
  Monitor,
  Moon,
  Sun,
  SunMoon,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { type ProfileView, readProfileAction, saveLanguageAction } from "@/app/actions/profile";
import { auth } from "@/lib/firebase/client";
import { applyTheme, readTheme, type ThemeChoice } from "@/lib/ui/theme";
import { AboutYouDialog } from "./AboutYouDialog";
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

/** What an unset language means to the agents: they answer in the language of the question. */
const NO_LANGUAGE = "Language of my question";

/** The account button at the foot of the sidebar: balance, then four groups — the sibling
 *  sites; All agents and Change wallet; Appearance, Preferred language and About you;
 *  Sign out. Preferred language opens its list in place of the menu (a flyout would not fit
 *  the phone drawer or the rail). Both are the user's Sebtember profile, read when the menu
 *  first opens and shared with sebtember.app.
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
  const [panel, setPanel] = useState<"main" | "language">("main");
  const [profile, setProfile] = useState<ProfileView | "loading" | "error" | null>(null);
  const [savingLanguage, setSavingLanguage] = useState<string | null>(null);
  const [languageError, setLanguageError] = useState(false);
  const [aboutYou, setAboutYou] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setTheme(readTheme()), []);

  // The profile is read once, the first time the menu opens (a failed read retries on the next).
  useEffect(() => {
    if (!open || (profile !== null && profile !== "error")) return;
    setProfile("loading");
    readProfileAction().then(
      (res) => setProfile(res.ok ? res.profile : "error"),
      () => setProfile("error"),
    );
  }, [open, profile]);

  // Closing the menu returns it to its main list.
  useEffect(() => {
    if (!open) {
      setPanel("main");
      setLanguageError(false);
    }
  }, [open]);

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

  async function pickLanguage(code: string) {
    if (typeof profile !== "object" || profile === null || savingLanguage !== null) return;
    if (code === profile.language) {
      setPanel("main");
      return;
    }
    setSavingLanguage(code);
    setLanguageError(false);
    const res = await saveLanguageAction(code).catch(() => null);
    setSavingLanguage(null);
    if (res?.ok) {
      setProfile(res.profile);
      setPanel("main");
    } else {
      setLanguageError(true);
    }
  }

  const ready = typeof profile === "object" && profile !== null ? profile : null;
  const languageLabel = ready
    ? (ready.languages.find((l) => l.code === ready.language)?.name ??
      (ready.language ? ready.language.toUpperCase() : NO_LANGUAGE))
    : profile === "error"
      ? "Unavailable"
      : "…";

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
          {panel === "language" && ready ? (
            <LanguagePanel
              profile={ready}
              saving={savingLanguage}
              failed={languageError}
              onBack={() => setPanel("main")}
              onPick={pickLanguage}
            />
          ) : (
            <>
              <div className="px-2.5 pt-1.5 pb-2.5">
                <p className="truncate text-[13px] text-ink2">{email ?? "Signed in"}</p>
                <p className="mt-1 text-[17px] font-bold">{line}</p>
                {balance.state === "ready" && (
                  <p className="text-[13px] text-ink2">
                    {balance.source === "personal" ? "Personal wallet" : "Shared wallet"} on
                    Sebtember
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
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                disabled={!ready}
                onClick={() => setPanel("language")}
                className={`${ITEM} disabled:cursor-default disabled:hover:bg-transparent`}
              >
                <Languages aria-hidden size={16} className="text-ink2" />
                <span className="flex-1">Preferred language</span>
                <span className="max-w-[45%] truncate text-[13px] text-ink2">{languageLabel}</span>
                <ChevronRight aria-hidden size={15} className="shrink-0 text-ink2" />
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!ready}
                onClick={() => {
                  setOpen(false);
                  setAboutYou(true);
                }}
                className={`${ITEM} disabled:cursor-default disabled:hover:bg-transparent`}
              >
                <UserRound aria-hidden size={16} className="text-ink2" />
                <span className="flex-1">About you</span>
                {ready && (
                  <span className="text-[13px] text-ink2">
                    {ready.persona ? "Written" : "Not set"}
                  </span>
                )}
              </button>
              <div className="my-1 h-px bg-hair" />
              <button type="button" role="menuitem" onClick={signOutBoth} className={ITEM}>
                <LogOut aria-hidden size={16} className="text-ink2" />
                Sign out
              </button>
            </>
          )}
        </div>
      )}
      {aboutYou && ready && (
        <AboutYouDialog
          initial={ready.persona}
          onClose={() => setAboutYou(false)}
          onSaved={(persona) => setProfile({ ...ready, persona })}
        />
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

/** The Preferred language list, in place of the menu: an unset language first, then every
 *  language Sebtember's picker offers, the current one ticked. */
function LanguagePanel({
  profile,
  saving,
  failed,
  onBack,
  onPick,
}: {
  profile: ProfileView;
  saving: string | null;
  failed: boolean;
  onBack: () => void;
  onPick: (code: string) => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const options = [{ code: "", name: NO_LANGUAGE }, ...profile.languages];

  return (
    <div className="flex flex-col">
      <button ref={first} type="button" onClick={onBack} className={`${ITEM} font-semibold`}>
        <ChevronLeft aria-hidden size={16} className="text-ink2" />
        Preferred language
      </button>
      <p className="px-2.5 pt-0.5 pb-2 text-[13px] leading-[18px] text-ink2">
        Agents answer in this language. Shared with sebtember.app.
      </p>
      <div className="my-0.5 h-px bg-hair" />
      <div
        role="menu"
        aria-label="Preferred language"
        className="max-h-[min(360px,50dvh)] overflow-y-auto py-0.5"
      >
        {options.map((l) => {
          const current = l.code === profile.language;
          return (
            <button
              key={l.code || "none"}
              type="button"
              role="menuitemradio"
              aria-checked={current}
              disabled={saving !== null}
              onClick={() => onPick(l.code)}
              className={`${ITEM} disabled:opacity-60`}
            >
              <span className="flex-1 truncate">{l.name}</span>
              {saving === l.code ? (
                <span className="text-[13px] text-ink2">Saving…</span>
              ) : (
                current && <Check aria-hidden size={16} className="text-act" />
              )}
            </button>
          );
        })}
      </div>
      {failed && (
        <p role="alert" className="px-2.5 pt-1.5 pb-1 text-[13px] text-danger">
          It couldn't be saved. Try again.
        </p>
      )}
    </div>
  );
}
