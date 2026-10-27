"use client";

import { House, Layers, LayoutGrid } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AgentIcon } from "@/components/ui/AgentIcon";
import { AGENTS } from "@/lib/agents/registry";
import { AccountMenu } from "./AccountMenu";
import { Logo } from "./Logo";

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
  onNavigate,
}: {
  email: string | null;
  topUpUrl: string | null;
  onNavigate?: () => void;
}) {
  const path = usePathname();
  const is = (href: string) => path === href || path.startsWith(`${href}/`);

  return (
    <nav aria-label="Plugent" className="flex h-full flex-col gap-1 bg-side px-3 pt-4 pb-3">
      <Link href="/home" onClick={onNavigate} className="mb-3 self-start px-2.5 py-1">
        <Logo className="h-6" />
      </Link>

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
          <NavRow
            key={agent.id}
            href={agent.href}
            active={is(agent.href)}
            icon={<AgentIcon agent={agent} />}
            label={agent.name}
            onNavigate={onNavigate}
          />
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

      <div className="mt-auto pt-3">
        <AccountMenu email={email} topUpUrl={topUpUrl} />
      </div>
    </nav>
  );
}
