/**
 * Loads the Chat review's evidence from Plugent's Firestore: every Chat run with a trace written in
 * the window, as whole conversations (every turn of the run, each with its trace when one is still
 * kept), plus the notes users sent about them. Read-only.
 */
import type { Firestore, Timestamp } from "firebase-admin/firestore";
import type { AskTrace } from "@/lib/agents/ask";
import type { Conversation, ReviewTurn } from "@/lib/review/chat-review";

const millis = (t: unknown) =>
  t && typeof (t as Timestamp).toMillis === "function" ? (t as Timestamp).toMillis() : 0;

export async function loadConversations(
  db: Firestore,
  days: number,
  limit = 200,
): Promise<Conversation[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const now = Date.now();
  // The collection-group index on `traces.createdAt` (firestore.indexes.json) serves this. NEWEST
  // first, so `limit` keeps the latest conversations; only the two fields it needs are read.
  const recent = await db
    .collectionGroup("traces")
    .where("createdAt", ">=", since)
    .orderBy("createdAt", "desc")
    .select("agent", "expireAt")
    .get();
  const runRefs = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const d of recent.docs) {
    if (d.get("agent") !== "chat") continue;
    // The TTL deletes lazily (often a day late): an expired trace is never evidence.
    if (millis(d.get("expireAt")) <= now) continue;
    const run = d.ref.parent.parent;
    if (run) runRefs.set(run.path, run);
  }

  const feedback = await db.collection("answer_feedback").where("createdAt", ">=", since).get();
  const notesByRun = new Map<string, string[]>();
  for (const f of feedback.docs) {
    if (f.get("agent") !== "chat" || !f.get("runId")) continue;
    const key = `${f.get("uid")}/${f.get("runId")}`;
    notesByRun.set(key, [
      ...(notesByRun.get(key) ?? []),
      String(f.get("text") ?? "").slice(0, 1000),
    ]);
  }

  const out: Conversation[] = [];
  for (const run of [...runRefs.values()].slice(0, limit)) {
    const uid = run.parent.parent?.id ?? "";
    const [turns, traces] = await Promise.all([
      run.collection("turns").orderBy("createdAt").get(),
      run.collection("traces").get(),
    ]);
    const traceOf = new Map(
      traces.docs.filter((t) => millis(t.get("expireAt")) > now).map((t) => [t.id, t.data()]),
    );
    const reviewTurns: ReviewTurn[] = turns.docs.map((t) => {
      const tr = traceOf.get(t.id);
      return {
        turnId: t.id,
        question: String(t.get("question") ?? ""),
        kind: t.get("kind") === "not_covered" ? "not_covered" : "answer",
        answer: String(t.get("answer") ?? ""),
        clarify: Boolean(t.get("clarify")),
        stopped: t.get("stopped") === true,
        trace: tr
          ? ({ ...(tr as AskTrace), createdAtMs: millis(tr.createdAt) } as ReviewTurn["trace"])
          : null,
      };
    });
    if (reviewTurns.length === 0) continue;
    out.push({
      uid,
      runId: run.id,
      turns: reviewTurns,
      feedback: notesByRun.get(`${uid}/${run.id}`) ?? [],
    });
  }
  return out;
}
