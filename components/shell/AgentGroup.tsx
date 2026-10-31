"use client";

import { ChevronDown, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { olderRunsAction } from "@/app/actions/run-history";
import { AgentIcon } from "@/components/ui/AgentIcon";
import type { AgentEntry } from "@/lib/agents/registry";
import { SIDEBAR_RUNS } from "@/lib/run-pages";
import type { RunSummary } from "@/lib/runs";
import { RunList } from "./RunList";

/**
 * One agent in the sidebar: "+ New" under the heading always starts a new session; the
 * heading's chevron folds the agent's runs (newest first) below it. An agent that is not built yet is a
 * heading with "Soon" and nothing to fold.
 *
 * The layout reads only the SIDEBAR_RUNS newest runs across all agents; when that read was cut,
 * "Show more" reads this agent's older runs a page at a time (`olderRunsAction`). They are kept
 * here, behind the layout's runs, and a run the layout now returns (it was updated) wins.
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
  const [older, setOlder] = useState<RunSummary[]>([]);
  // undefined: not read yet; null: nothing older is left.
  const [cursor, setCursor] = useState<number | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
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
  const recent = runs?.filter((r) => r.agent === agent.id) ?? [];
  const shown = new Set(recent.map((r) => r.id));
  const list = [...recent, ...older.filter((r) => !shown.has(r.id))];
  const oldest = runs?.[runs.length - 1]?.updatedAt;
  const canShowMore =
    runs !== null &&
    (cursor === undefined ? runs.length >= SIDEBAR_RUNS && oldest !== undefined : cursor !== null);

  async function showMore() {
    const before = cursor ?? oldest;
    if (loading || before == null) return;
    setLoading(true);
    setFailed(false);
    const res = await olderRunsAction(agent.id, before).catch(() => null);
    setLoading(false);
    if (!res?.ok) return setFailed(true);
    setOlder((o) => {
      const have = new Set(o.map((r) => r.id));
      return [...o, ...res.runs.filter((r) => !have.has(r.id))];
    });
    setCursor(res.cursor);
  }
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
                runs={list}
                hrefFor={(id) => `${agent.href}/${id}`}
                onNavigate={onNavigate}
                onRemoved={(id) => setOlder((o) => o.filter((r) => r.id !== id))}
              />
            )}
            {canShowMore && (
              <button
                type="button"
                onClick={showMore}
                disabled={loading}
                className="flex h-8 w-full items-center rounded-chip pl-2.5 text-left text-[13px] font-semibold text-link hover:bg-fill1 disabled:opacity-60"
              >
                {loading ? "Loading…" : "Show more"}
              </button>
            )}
            {failed && (
              <p role="alert" className="py-1 pl-2.5 text-[12px] text-danger">
                Couldn't load older runs. Try again.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
