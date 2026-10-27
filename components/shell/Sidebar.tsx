"use client";

import { House, Layers, LayoutGrid, Lightbulb } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AgentIcon } from "@/components/ui/AgentIcon";
import { AGENTS } from "@/lib/agents/registry";
import type { RunSummary } from "@/lib/runs";
import { AccountMenu } from "./AccountMenu";
import { Logo } from "./Logo";
import { RunList } from "./RunList";

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

/** Agent-first: Home, every agent, All agents, then the knowledge the agents read. */
export function Sidebar({
  email,
  topUpUrl,
  runs,
  onNavigate,
}: {
  email: string | null;
  topUpUrl: string | null;
  runs: RunSummary[] | null;
  onNavigate?: () => void;
}) {
  const path = usePathname();
  const is = (href: string) => path === href || path.startsWith(`${href}/`);

  return (
    <nav aria-label="Plugent" className="flex h-full flex-col bg-side pt-4 pb-3">
      <Link href="/home" onClick={onNavigate} className="mx-3 mb-3 self-start px-2.5 py-1">
        <Logo className="h-6" />
      </Link>
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
        {AGENTS.map((agent) =>
          agent.available ? (
            <div key={agent.id} className="flex flex-col gap-0.5">
              <NavRow
                href={agent.href}
                active={path === agent.href}
                icon={<AgentIcon agent={agent} />}
                label={agent.name}
                onNavigate={onNavigate}
              />
              {runs === null ? (
                <p className="ml-[22px] border-hair border-l-[0.5px] py-1 pl-4 text-[12px] text-ink2">
                  History unavailable just now
                </p>
              ) : (
                <RunList
                  runs={runs.filter((r) => r.agent === agent.id)}
                  hrefFor={(id) => `${agent.href}/${id}`}
                  onNavigate={onNavigate}
                />
              )}
            </div>
          ) : (
            <div key={agent.id} className={`${ROW} text-ink2`} title="Coming soon">
              <span className="opacity-60">
                <AgentIcon agent={agent} />
              </span>
              <span className="truncate">{agent.name}</span>
              <span className="ml-auto rounded-chip bg-fill1 px-2 py-0.5 text-[12px] font-semibold">
                Soon
              </span>
            </div>
          ),
        )}
        <NavRow
          href="/agents"
          active={path === "/agents"}
          icon={
            <PlainIcon>
              <LayoutGrid aria-hidden size={16} strokeWidth={1.8} />
            </PlainIcon>
          }
          label="All agents"
          onNavigate={onNavigate}
        />
        <NavRow
          href="/agents/suggest"
          active={path === "/agents/suggest"}
          icon={
            <PlainIcon>
              <Lightbulb aria-hidden size={16} strokeWidth={1.8} />
            </PlainIcon>
          }
          label="Suggest an agent"
          onNavigate={onNavigate}
        />

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
        <AccountMenu email={email} topUpUrl={topUpUrl} />
      </div>
    </nav>
  );
}
