import { notFound, redirect } from "next/navigation";
import { TroubleshootAgent } from "@/components/agents/TroubleshootAgent";
import { getSessionUser } from "@/lib/auth/session";
import { readPrefsOrDefaults } from "@/lib/prefs";
import { isRunId, readTsRun, TS_NEW_STATE } from "@/lib/runs";

export const dynamic = "force-dynamic";

/** `/agents/troubleshooting` starts a new run; `/agents/troubleshooting/{runId}` reopens one. */
export default async function TroubleshootingPage({
  params,
}: {
  params: Promise<{ run?: string[] }>;
}) {
  const { run } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/");
  const prefs = await readPrefsOrDefaults(user.uid);
  const off = prefs.disabledAgents.includes("troubleshooting");
  if (!run || run.length === 0) {
    return (
      <TroubleshootAgent
        runId={null}
        title={null}
        initialState={TS_NEW_STATE}
        initialTurns={[]}
        off={off}
      />
    );
  }
  const [runId] = run;
  if (run.length > 1 || !runId || !isRunId(runId)) notFound();
  const stored = await readTsRun(user.uid, runId);
  if (!stored) notFound();
  return (
    <TroubleshootAgent
      runId={runId}
      title={stored.run.title}
      initialState={stored.state}
      initialTurns={stored.turns}
      off={off}
    />
  );
}
