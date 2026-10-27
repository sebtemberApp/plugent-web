"use client";

import { ArrowLeftToLine, House, Layers } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AGENTS, type AgentId } from "@/lib/agents/registry";
import type { RunSummary } from "@/lib/runs";
import { readStored, writeStored } from "@/lib/ui/stored";
import { AccountMenu } from "./AccountMenu";
import { AgentGroup } from "./AgentGroup";
import { Logo } from "./Logo";

const FOLDED_KEY = "plugent-sidebar-folded";

const ROW =
  "flex h-10 w-full items-center gap-3 rounded-control px-2.5 text-left text-[15px] font-medium";

function NavRow({
  href,
  active,
  icon,
  label,
  onNavigate,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`${ROW} ${active ? "bg-sel text-ink" : "text-ink hover:bg-fill1"}`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );
}

function PlainIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-chip bg-fill1 text-ink2">
      {children}
    </span>
  );
}

/** Agent-first: Home, every agent, then the knowledge the agents read. All agents and
 *  Suggest an agent are reached from Home. */
export function Sidebar({
  email,
  sebtemberUrl,
  runs,
  disabledAgents,
  onNavigate,
  onHide,
}: {
  email: string | null;
  sebtemberUrl: string | null;
  runs: RunSummary[] | null;
  disabledAgents: AgentId[];
  onNavigate?: () => void;
  /** Hides the sidebar (wide screens); absent in the phone drawer. */
  onHide?: () => void;
}) {
  const path = usePathname();
  const is = (href: string) => path === href || path.startsWith(`${href}/`);
  // Folded agent groups, remembered per browser; every group starts open.
  const [folded, setFolded] = useState<AgentId[]>([]);
  useEffect(() => setFolded(readStored<AgentId[]>(FOLDED_KEY, [])), []);
  const toggle = (id: AgentId) =>
    setFolded((f) => {
      const next = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
      writeStored(FOLDED_KEY, next);
      return next;
    });

  return (
    <nav aria-label="Plugent" className="flex h-full flex-col bg-side pt-4 pb-3">
      <div className="mx-3 mb-3 flex items-center justify-between">
        <Link href="/home" onClick={onNavigate} className="px-2.5 py-1">
          <Logo className="h-6" />
        </Link>
        {onHide && (
          <button
            type="button"
            aria-label="Hide sidebar"
            title="Hide sidebar"
            onClick={onHide}
            className="flex size-9 items-center justify-center rounded-full text-ink2 hover:bg-fill1 hover:text-ink"
          >
            <ArrowLeftToLine aria-hidden size={18} />
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4">
        <NavRow
          href="/home"
          active={path === "/home"}
          icon={
            <PlainIcon>
              <House aria-hidden size={16} strokeWidth={1.8} />
            </PlainIcon>
          }
          label="Home"
          onNavigate={onNavigate}
        />

        <h2 className="mt-4 mb-1 px-2.5 text-[13px] font-semibold text-ink2">Agents</h2>
        {AGENTS.filter((a) => !disabledAgents.includes(a.id)).map((agent) => (
          <AgentGroup
            key={agent.id}
            agent={agent}
            runs={runs}
            open={!folded.includes(agent.id)}
            onToggle={() => toggle(agent.id)}
            onNavigate={onNavigate}
          />
        ))}

        <h2 className="mt-4 mb-1 px-2.5 text-[13px] font-semibold text-ink2">Your knowledge</h2>
        <NavRow
          href="/knowledge"
          active={is("/knowledge")}
          icon={
            <PlainIcon>
              <Layers aria-hidden size={16} strokeWidth={1.8} />
            </PlainIcon>
          }
          label="Knowledge"
          onNavigate={onNavigate}
        />
      </div>
      <div className="border-hair border-t-[0.5px] px-3 pt-3">
        <AccountMenu email={email} sebtemberUrl={sebtemberUrl} />
      </div>
    </nav>
  );
}
