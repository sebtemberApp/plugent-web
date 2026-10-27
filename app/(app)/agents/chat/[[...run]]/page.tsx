import { notFound, redirect } from "next/navigation";
import { ChatAgent } from "@/components/agents/ChatAgent";
import { getSessionUser } from "@/lib/auth/session";
import { isRunId, readRun } from "@/lib/runs";

export const dynamic = "force-dynamic";

/**
 * `/agents/chat` starts a new chat; `/agents/chat/{runId}` reopens a stored one. One route
 * for both, so the page stays mounted when the first answer gives the new chat its URL.
 */
export default async function ChatPage({ params }: { params: Promise<{ run?: string[] }> }) {
  const { run } = await params;
  if (!run || run.length === 0) return <ChatAgent runId={null} title={null} initialTurns={[]} />;
  const [runId] = run;
  if (run.length > 1 || !runId || !isRunId(runId)) notFound();
  const user = await getSessionUser();
  if (!user) redirect("/");
  const stored = await readRun(user.uid, runId);
  if (!stored || stored.run.agent !== "chat") notFound();
  return <ChatAgent runId={runId} title={stored.run.title} initialTurns={stored.turns} />;
}
