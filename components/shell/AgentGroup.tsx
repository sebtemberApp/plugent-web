"use client";

import { ChevronDown, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AgentIcon } from "@/components/ui/AgentIcon";
import type { AgentEntry } from "@/lib/agents/registry";
import type { RunSummary } from "@/lib/runs";
import { RunList } from "./RunList";

/**
 * One agent in the sidebar: "+ New" under the heading always starts a new session; the
 * heading's chevron folds the agent's runs (newest first) below it. An agent that is not built yet is a
 * heading with "Soon" and nothing to fold.
 */
export function AgentGroup({
  agent,
  runs,
  open,
  onToggle,
  onNavigate,
}: {
  agent: AgentEntry;
  /** null when the history could not be read. */
  runs: RunSummary[] | null;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const path = usePathname();
  const heading =
    "flex h-10 w-full items-center gap-3 rounded-control px-2.5 text-left text-[15px]";

  if (!agent.available) {
    return (
      <div className={`${heading} font-medium text-ink2`} title="Coming soon">
        <span className="opacity-60">
          <AgentIcon agent={agent} />
        </span>
        <span className="truncate">{agent.name}</span>
        <span className="ml-auto rounded-chip bg-fill1 px-2 py-0.5 text-[12px] font-semibold">
          Soon
        </span>
      </div>
    );
  }

  const panel = `agent-group-${agent.id}`;
  const fresh = path === agent.href;
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={onToggle}
        className={`${heading} font-semibold text-ink hover:bg-fill1`}
      >
        <AgentIcon agent={agent} />
        <span className="truncate">{agent.name}</span>
        <ChevronDown
          aria-hidden
          size={16}
          className={`ml-auto text-ink2 transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      <div className="mb-1 ml-[22px] flex flex-col border-hair border-l-[0.5px] pl-2">
        {/* "+ New" stays visible when the group is folded, as in sebtember.app's sidebar;
            the chevron folds only the runs. */}
        <Link
          href={agent.href}
          onClick={onNavigate}
          aria-current={fresh ? "page" : undefined}
          className={`flex h-9 items-center gap-2 rounded-chip pl-2.5 text-[14px] ${
            fresh ? "bg-sel font-semibold text-ink" : "text-ink2 hover:bg-fill1 hover:text-ink"
          }`}
        >
          <Plus aria-hidden size={16} />
          New
          <span className="sr-only">{agent.name.toLowerCase()}</span>
        </Link>
        {open && (
          <div id={panel}>
            {runs === null ? (
              <p className="py-1 pl-2.5 text-[12px] text-ink2">History unavailable just now</p>
            ) : (
              <RunList
                runs={runs.filter((r) => r.agent === agent.id)}
                hrefFor={(id) => `${agent.href}/${id}`}
                onNavigate={onNavigate}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
