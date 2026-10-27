import { ThreadPage } from "@/components/agents/ThreadPage";

export const dynamic = "force-dynamic";

/** `/agents/chat` starts a new chat; `/agents/chat/{runId}` reopens a stored one. */
export default async function ChatPage({ params }: { params: Promise<{ run?: string[] }> }) {
  const { run } = await params;
  return <ThreadPage agent="chat" run={run} />;
}
