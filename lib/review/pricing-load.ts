/**
 * Loads the Pricing review's evidence from Plugent's Firestore: every Pricing run with a trace
 * written in the window, as one case per run (its latest read, every match, the notes users sent
 * about it). Read-only. Chat's loader (`lib/review/load.ts`) is the template.
 */
import type { Firestore, Timestamp } from "firebase-admin/firestore";
import type { PricingCase } from "@/lib/review/pricing-review";
import type { ExtractTrace, MatchTrace } from "@/lib/review/pricing-trace";

const millis = (t: unknown) =>
  t && typeof (t as Timestamp).toMillis === "function" ? (t as Timestamp).toMillis() : 0;

export async function loadPricingCases(
  db: Firestore,
  days: number,
  limit = 100,
): Promise<PricingCase[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const now = Date.now();
  // The collection-group index on `traces.createdAt` (firestore.indexes.json), as Chat's loader.
  const recent = await db
    .collectionGroup("traces")
    .where("createdAt", ">=", since)
    .orderBy("createdAt", "desc")
    .select("agent", "expireAt")
    .get();
  const runRefs = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const d of recent.docs) {
    if (d.get("agent") !== "pricing") continue;
    if (millis(d.get("expireAt")) <= now) continue;
    const run = d.ref.parent.parent;
    if (run) runRefs.set(run.path, run);
  }

  const feedback = await db.collection("answer_feedback").where("createdAt", ">=", since).get();
  const notesByRun = new Map<string, string[]>();
  for (const f of feedback.docs) {
    if (f.get("agent") !== "pricing" || !f.get("runId")) continue;
    const key = `${f.get("uid")}/${f.get("runId")}`;
    notesByRun.set(key, [
      ...(notesByRun.get(key) ?? []),
      String(f.get("text") ?? "").slice(0, 1000),
    ]);
  }

  const out: PricingCase[] = [];
  for (const run of [...runRefs.values()].slice(0, limit)) {
    const uid = run.parent.parent?.id ?? "";
    const traces = (await run.collection("traces").get()).docs
      .filter((t) => t.get("agent") === "pricing" && millis(t.get("expireAt")) > now)
      .sort((a, b) => millis(a.get("createdAt")) - millis(b.get("createdAt")));
    const reads = traces.filter((t) => t.get("stage") === "extract");
    const matches = traces.filter((t) => t.get("stage") === "match");
    if (reads.length + matches.length === 0) continue;
    out.push({
      uid,
      runId: run.id,
      extract: (reads.at(-1)?.data() as ExtractTrace | undefined) ?? null,
      matches: matches.map((m) => m.data() as MatchTrace),
      feedback: notesByRun.get(`${uid}/${run.id}`) ?? [],
    });
  }
  return out;
}
