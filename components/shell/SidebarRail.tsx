"use client";

import { ArrowRightToLine, House, Layers } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AgentIcon } from "@/components/ui/AgentIcon";
import { AGENTS } from "@/lib/agents/registry";
import { AccountMenu } from "./AccountMenu";

const CELL = "flex size-10 items-center justify-center rounded-control";

function RailLink({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      className={`${CELL} ${active ? "bg-sel" : "hover:bg-fill1"}`}
    >
      {children}
    </Link>
  );
}

/** The hidden sidebar: a 56px rail of icons (Home, each agent, Knowledge, the account),
 *  with the arrow that brings the full sidebar back. An agent's icon starts a new session;
 *  its runs are in the full sidebar. */
export function SidebarRail({
  email,
  topUpUrl,
  onShow,
}: {
  email: string | null;
  topUpUrl: string | null;
  onShow: () => void;
}) {
  const path = usePathname();
  const is = (href: string) => path === href || path.startsWith(`${href}/`);

  return (
    <nav aria-label="Plugent" className="flex h-full flex-col items-center bg-side pt-4 pb-3">
      <button
        type="button"
        aria-label="Show sidebar"
        title="Show sidebar"
        onClick={onShow}
        className="flex size-9 items-center justify-center rounded-full text-ink2 hover:bg-fill1 hover:text-ink"
      >
        <ArrowRightToLine aria-hidden size={18} />
      </button>

      <div className="mt-3 flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
        <RailLink href="/home" label="Home" active={path === "/home"}>
          <span className="flex size-7 items-center justify-center rounded-chip bg-fill1 text-ink2">
            <House aria-hidden size={16} strokeWidth={1.8} />
          </span>
        </RailLink>

        <span aria-hidden className="my-2 h-px w-6 bg-hair" />
        {AGENTS.map((agent) =>
          agent.available ? (
            <RailLink
              key={agent.id}
              href={agent.href}
              label={`New ${agent.name} session`}
              active={is(agent.href)}
            >
              <AgentIcon agent={agent} />
            </RailLink>
          ) : (
            <span key={agent.id} title={`${agent.name} · Soon`} className={`${CELL} opacity-45`}>
              <AgentIcon agent={agent} />
            </span>
          ),
        )}

        <span aria-hidden className="my-2 h-px w-6 bg-hair" />
        <RailLink href="/knowledge" label="Knowledge" active={is("/knowledge")}>
          <span className="flex size-7 items-center justify-center rounded-chip bg-fill1 text-ink2">
            <Layers aria-hidden size={16} strokeWidth={1.8} />
          </span>
        </RailLink>
      </div>

      <div className="border-hair border-t-[0.5px] pt-3">
        <AccountMenu email={email} topUpUrl={topUpUrl} compact />
      </div>
    </nav>
  );
}
