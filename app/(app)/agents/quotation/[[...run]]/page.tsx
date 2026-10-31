import { ThreadPage } from "@/components/agents/ThreadPage";

export const dynamic = "force-dynamic";

/** `/agents/quotation` starts a new run; `/agents/quotation/{runId}` reopens a stored one. */
export default async function QuotationPage({ params }: { params: Promise<{ run?: string[] }> }) {
  const { run } = await params;
  return <ThreadPage agent="quotation" run={run} />;
}
