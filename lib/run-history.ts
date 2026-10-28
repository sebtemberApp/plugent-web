/**
 * One agent's older runs, for the sidebar's "Show more" (audit F4). The layout reads only the
 * SIDEBAR_RUNS newest runs across all agents; this reads further back, one agent at a time.
 *
 * ⚠️ NO COMPOSITE INDEX: the runs are scanned newest first on `updatedAt` alone (the index
 * Firestore builds by itself) and filtered by agent here, so nothing needs deploying. A call
 * reads at most SCAN_BATCHES × SCAN_BATCH runs and hands back a cursor to continue from.
 * ⚠️ THE CURSOR IS INCLUSIVE (`updatedAt` < cursor + 1 ms): a run sharing the boundary
 * millisecond comes back twice rather than never, and the sidebar drops the repeat by id.
 */
import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import type { AgentId } from "@/lib/agents/registry";
import { plugentDb } from "@/lib/firebase/admin";
import { OLDER_RUNS_PAGE } from "@/lib/run-pages";
import type { RunSummary } from "@/lib/runs";

const SCAN_BATCH = 100;
const SCAN_BATCHES = 5;

export interface OlderRuns {
  runs: RunSummary[];
  /** Where the next "Show more" starts (ms); null when the history is exhausted. */
  cursor: number | null;
}

function millis(t: unknown): number {
  return t instanceof Timestamp ? t.toMillis() : 0;
}

/** Up to OLDER_RUNS_PAGE of `agent`'s runs last updated at or before `beforeMs`, newest first. */
export async function listOlderRuns(
  uid: string,
  agent: AgentId,
  beforeMs: number,
): Promise<OlderRuns> {
  const base = plugentDb()
    .collection("users")
    .doc(uid)
    .collection("runs")
    .where("updatedAt", "<", Timestamp.fromMillis(beforeMs + 1))
    .orderBy("updatedAt", "desc");
  const found: RunSummary[] = [];
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (let batch = 0; batch < SCAN_BATCHES; batch++) {
    const snap = await (last ? base.startAfter(last) : base).limit(SCAN_BATCH).get();
    for (const d of snap.docs) {
      const data = d.data();
      if (data.agent !== agent) continue;
      found.push({
        id: d.id,
        agent: data.agent,
        title: String(data.title ?? "Untitled"),
        updatedAt: millis(data.updatedAt),
        tokensUsed: Number(data.tokensUsed ?? 0),
        turnCount: Number(data.turnCount ?? 0),
      });
      if (found.length === OLDER_RUNS_PAGE) {
        return { runs: found, cursor: millis(data.updatedAt) };
      }
    }
    if (snap.size < SCAN_BATCH) return { runs: found, cursor: null };
    last = snap.docs[snap.docs.length - 1] ?? null;
  }
  // Scanned the call's budget without filling a page: more may lie further back.
  return { runs: found, cursor: last ? millis(last.get("updatedAt")) : null };
}
