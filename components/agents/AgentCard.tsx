import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { AgentIcon } from "@/components/ui/AgentIcon";
import type { AskMode } from "@/lib/agents/ask";
import type { AgentEntry } from "@/lib/agents/registry";
import { AgentSwitch, ChatSettingsButton } from "./AgentControls";

const SHELL = "flex flex-col gap-4 rounded-card bg-card p-5 shadow-card";

function Heading({ agent, right }: { agent: AgentEntry; right: React.ReactNode }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <AgentIcon agent={agent} size="card" />
        {right}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-[17px] font-bold">{agent.name}</h3>
        <p className="text-[15px] leading-[22px] text-ink2">{agent.description}</p>
      </div>
    </>
  );
}

function Soon() {
  return (
    <span className="rounded-chip bg-fill1 px-2 py-0.5 text-[12px] font-semibold text-ink2">
      Coming soon
    </span>
  );
}

/** One agent on Home: a link when it runs, a quiet card when it is coming. */
export function AgentCard({ agent }: { agent: AgentEntry }) {
  return agent.available ? (
    <Link href={agent.href} className={`${SHELL} transition-transform hover:-translate-y-0.5`}>
      <Heading
        agent={agent}
        right={<ArrowRight aria-hidden size={18} className="mt-2 text-ink2" />}
      />
    </Link>
  ) : (
    <div className={`${SHELL} opacity-75`}>
      <Heading agent={agent} right={<Soon />} />
    </div>
  );
}

/**
 * One agent on All agents, with its controls in a footer: ON/OFF for every agent, and
 * Chat's settings gear. The card links to the agent only while it runs and is on.
 */
export function AgentControlCard({
  agent,
  enabled,
  chatMode,
}: {
  agent: AgentEntry;
  enabled: boolean;
  chatMode: AskMode;
}) {
  const open = agent.available && enabled;
  return (
    <div className={SHELL}>
      <div className={`flex flex-col gap-4 ${enabled ? "" : "opacity-55"}`}>
        <Heading
          agent={agent}
          right={
            !agent.available ? (
              <Soon />
            ) : open ? (
              <Link
                href={agent.href}
                aria-label={`Open ${agent.name}`}
                className="mt-1 flex size-8 items-center justify-center rounded-full text-ink2 hover:bg-fill1 hover:text-ink"
              >
                <ArrowRight aria-hidden size={18} />
              </Link>
            ) : (
              <span className="rounded-chip bg-fill1 px-2 py-0.5 text-[12px] font-semibold text-ink2">
                Off
              </span>
            )
          }
        />
      </div>
      <div className="mt-auto flex min-h-9 items-center justify-between gap-3">
        {agent.id === "chat" ? <ChatSettingsButton mode={chatMode} /> : <span />}
        <AgentSwitch agent={agent} enabled={enabled} />
      </div>
    </div>
  );
}
