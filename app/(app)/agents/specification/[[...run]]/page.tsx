import { ThreadPage } from "@/components/agents/ThreadPage";

export const dynamic = "force-dynamic";

/** `/agents/specification` starts a new run; `/agents/specification/{runId}` reopens a stored one. */
export default async function SpecificationPage({
  params,
}: {
  params: Promise<{ run?: string[] }>;
}) {
  const { run } = await params;
  return <ThreadPage agent="specification" run={run} />;
}
