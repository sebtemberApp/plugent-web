import { AgentCard } from "@/components/agents/AgentCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { AGENTS } from "@/lib/agents/registry";

export default function AllAgents() {
  const ready = AGENTS.filter((a) => a.available);
  const coming = AGENTS.filter((a) => !a.available);
  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-8 px-4 py-8 min-[600px]:px-8 min-[600px]:py-10">
      <PageHeader
        title="All agents"
        lead="Every agent reads only the catalogues you connected and charges your Sebtember balance."
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-[22px] font-bold">Ready to use</h2>
        <div className="grid gap-4 min-[600px]:grid-cols-2 min-[1100px]:grid-cols-3">
          {ready.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      </section>
      {coming.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[22px] font-bold">Coming soon</h2>
          <div className="grid gap-4 min-[600px]:grid-cols-2 min-[1100px]:grid-cols-3">
            {coming.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
