import { notFound, redirect } from "next/navigation";
import { ChatAgent, type ThreadAgent } from "@/components/agents/ChatAgent";
import { getSessionUser } from "@/lib/auth/session";
import { readPrefsOrDefaults } from "@/lib/prefs";
import { isRunId, readRun } from "@/lib/runs";

/**
 * A thread agent's page: `/agents/{agent}` starts a new run; `/agents/{agent}/{runId}`
 * reopens a stored one. One route for both, so the page stays mounted when the first
 * answer gives the new run its URL. A run of another agent is not found here.
 */
export async function ThreadPage({ agent, run }: { agent: ThreadAgent; run?: string[] }) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const prefs = await readPrefsOrDefaults(user.uid);
  const settings = {
    agent,
    off: prefs.disabledAgents.includes(agent),
    defaultMode: prefs.chatMode,
  };
  if (!run || run.length === 0) {
    return <ChatAgent runId={null} title={null} initialTurns={[]} {...settings} />;
  }
  const [runId] = run;
  if (run.length > 1 || !runId || !isRunId(runId)) notFound();
  const stored = await readRun(user.uid, runId);
  if (!stored || stored.run.agent !== agent) notFound();
  return (
    <ChatAgent runId={runId} title={stored.run.title} initialTurns={stored.turns} {...settings} />
  );
}
