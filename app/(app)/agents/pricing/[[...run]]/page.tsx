import { notFound, redirect } from "next/navigation";
import { PricingView } from "@/components/pricing/PricingView";
import { getSessionUser } from "@/lib/auth/session";
import { readPrefsOrDefaults } from "@/lib/prefs";
import { BLANK_PRICING, type PricingRunData, pricingInitial } from "@/lib/pricing/view";
import { isRunId, readPricingRun } from "@/lib/runs";
import { getPricing } from "@/lib/sebtember/pricing";

export const dynamic = "force-dynamic";

/** `/agents/pricing` starts a new pricing; `/agents/pricing/{runId}` reopens one from sebtember. */
export default async function PricingPage({ params }: { params: Promise<{ run?: string[] }> }) {
  const { run } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/");
  const prefs = await readPrefsOrDefaults(user.uid);
  const enabled = !prefs.disabledAgents.includes("pricing");
  if (!run || run.length === 0) {
    return <PricingView runId={null} enabled={enabled} initial={BLANK_PRICING} />;
  }
  const [runId] = run;
  if (run.length > 1 || !runId || !isRunId(runId)) notFound();
  const stored = await readPricingRun(user.uid, runId);
  if (!stored) notFound();
  // A run sebtember no longer has (deleted there) is gone here too.
  const data = await getPricing(user.uid, stored.pricingId).catch((err) => {
    if (err?.status === 404) return null;
    throw err;
  });
  if (!data) notFound();
  return (
    <PricingView
      runId={runId}
      runTitle={stored.title}
      enabled={enabled}
      initial={pricingInitial(data as unknown as PricingRunData)}
    />
  );
}
