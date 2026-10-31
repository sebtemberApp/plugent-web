import { SuggestAgentForm } from "@/components/agents/SuggestAgentForm";
import { PageHeader } from "@/components/ui/PageHeader";

export default function SuggestAgentPage() {
  return (
    <main className="mx-auto flex w-full max-w-[640px] flex-col gap-8 px-4 py-8 min-[600px]:px-8 min-[600px]:py-10">
      <PageHeader
        title="Suggest an agent"
        lead="Tell us what you would like an agent to do for you. We read every suggestion and add the agents most people need."
      />
      <SuggestAgentForm />
    </main>
  );
}
