import { redirect } from "next/navigation";
import { AgentControlCard } from "@/components/agents/AgentCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { AGENTS } from "@/lib/agents/registry";
import { getSessionUser } from "@/lib/auth/session";
import { readPrefsOrDefaults } from "@/lib/prefs";

export const dynamic = "force-dynamic";

/** Every agent, each with ON/OFF (and Chat's settings). Off hides it from the sidebar and Home. */
export default async function AllAgents() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const prefs = await readPrefsOrDefaults(user.uid);
  const card = (a: (typeof AGENTS)[number]) => (
    <AgentControlCard
      key={a.id}
      agent={a}
      enabled={!prefs.disabledAgents.includes(a.id)}
      chatMode={prefs.chatMode}
    />
  );
  const ready = AGENTS.filter((a) => a.available);
  const coming = AGENTS.filter((a) => !a.available);
  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-8 px-4 py-8 min-[600px]:px-8 min-[600px]:py-10">
      <PageHeader
        title="All agents"
        lead="Turn an agent off to hide it from the sidebar and Home. Every agent reads your Sebtember catalogues and charges your Sebtember balance."
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-[22px] font-bold">Ready to use</h2>
        <div className="grid gap-4 min-[600px]:grid-cols-2 min-[1100px]:grid-cols-3">
          {ready.map(card)}
        </div>
      </section>
      {coming.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[22px] font-bold">Coming soon</h2>
          <div className="grid gap-4 min-[600px]:grid-cols-2 min-[1100px]:grid-cols-3">
            {coming.map(card)}
          </div>
        </section>
      )}
    </main>
  );
}
