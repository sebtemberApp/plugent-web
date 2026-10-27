import { Layers } from "lucide-react";
import Link from "next/link";
import { AgentCard } from "@/components/agents/AgentCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { AGENTS } from "@/lib/agents/registry";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-8 px-4 py-8 min-[600px]:px-8 min-[600px]:py-10">
      <PageHeader
        title="What do you want to do?"
        lead="Pick an agent. It works from the Sebtember catalogues you connected."
      />
      <section
        aria-label="Agents"
        className="grid gap-4 min-[600px]:grid-cols-2 min-[1100px]:grid-cols-3"
      >
        {AGENTS.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </section>
      <Link
        href="/knowledge"
        className="flex items-center gap-4 rounded-list bg-card p-4 shadow-card hover:bg-fill1"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-fill1 text-ink2">
          <Layers aria-hidden size={20} strokeWidth={1.8} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-bold">Your knowledge</span>
          <span className="text-[13px] text-ink2">
            See which catalogues the agents read, or connect more on Sebtember.
          </span>
        </span>
      </Link>
    </main>
  );
}
