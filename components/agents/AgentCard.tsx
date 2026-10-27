import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { AgentIcon } from "@/components/ui/AgentIcon";
import type { AgentEntry } from "@/lib/agents/registry";

/** One agent on Home and All agents: a link when it runs, a quiet card when it is coming. */
export function AgentCard({ agent }: { agent: AgentEntry }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <AgentIcon agent={agent} size="card" />
        {agent.available ? (
          <ArrowRight aria-hidden size={18} className="mt-2 text-ink2" />
        ) : (
          <span className="rounded-chip bg-fill1 px-2 py-0.5 text-[12px] font-semibold text-ink2">
            Coming soon
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-[17px] font-bold">{agent.name}</h3>
        <p className="text-[15px] leading-[22px] text-ink2">{agent.description}</p>
      </div>
    </>
  );
  const shell = "flex flex-col gap-4 rounded-card bg-card p-5 shadow-card";
  return agent.available ? (
    <Link href={agent.href} className={`${shell} transition-transform hover:-translate-y-0.5`}>
      {body}
    </Link>
  ) : (
    <div className={`${shell} opacity-75`}>{body}</div>
  );
}
