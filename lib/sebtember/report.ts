/**
 * What a finished run drew on, reported to sebtember (sebtember Step 1228,
 * `/api/products/knowledge/report`), so the owners of the documents get the same weekly credit
 * and Insights gap cards a Sebtember chat, troubleshooting or specification run gives them.
 *
 * ⚠️ AFTER THE CHARGE, AND NEVER IN THE WAY: sent under `after()`, once the run is paid for; a
 * failure is logged and nothing else (the user's answer never waits for it or fails on it).
 * ⚠️ ONCE PER RUN: `requestId` is the run's (a troubleshooting TURN's) own id, so a retry is a
 * duplicate on sebtember's side.
 * ⚠️ THE FILES ARE THE PASSAGES THE MODEL READ, as sebtember credits what retrieval found. Who
 * gets the credit is sebtember's call: it counts only catalogues the user can read through
 * Plugent right now.
 * ⚠️ THE GAP REASONS ARE SEBTEMBER'S OWN, decided the way its functions decide them: `thin`
 * when the search was thin; `no_procedure` when a troubleshooting run ran out of steps on a
 * normal or rich search. Plugent has no signal for chat's `not_covered` or a specification's
 * `wrong_product`, so it never sends them.
 */
import "server-only";
import { after } from "next/server";
import { type KnowledgePassage, post } from "@/lib/sebtember/products";

export type ReportFunction = "chat" | "troubleshooting" | "specification" | "quotation";
export type ReportGapReason = "thin" | "no_procedure";

export interface RunReport {
  function: ReportFunction;
  requestId: string;
  passages: KnowledgePassage[];
  retrievalStrength: string;
  /** The question / problem / subject the owner reads on the gap card. */
  gap?: { reason: ReportGapReason; query: string };
}

/** Sebtember's caps (`MAX_REPORT_SOURCES`, `MAX_REPORT_QUERY_CHARS`). */
const MAX_SOURCES = 50;
const MAX_QUERY_CHARS = 500;

/** The `/api/products/knowledge/report` body: one source per file, in relevance order. */
export function reportBody(uid: string, r: RunReport) {
  const seen = new Set<string>();
  const sources: { catalogue_id: string; file_name: string; page?: string }[] = [];
  for (const p of r.passages) {
    const key = `${p.catalogue_id}\u0000${p.file_name}`;
    if (seen.has(key) || !p.file_name.trim()) continue;
    seen.add(key);
    sources.push({
      catalogue_id: p.catalogue_id,
      file_name: p.file_name,
      ...(p.page ? { page: p.page } : {}),
    });
    if (sources.length === MAX_SOURCES) break;
  }
  const query = r.gap?.query.trim().slice(0, MAX_QUERY_CHARS) ?? "";
  return {
    uid,
    request_id: r.requestId,
    function: r.function,
    sources,
    retrieval_strength: r.retrievalStrength,
    ...(r.gap && query ? { gap: { reason: r.gap.reason, query } } : {}),
  };
}

/** The gap a search's strength alone says: `thin`, else none. */
export function thinGap(retrievalStrength: string, query: string): RunReport["gap"] | undefined {
  return retrievalStrength === "thin" ? { reason: "thin", query } : undefined;
}

/** Sends the report once the response is done. Nothing read → nothing to report. */
export function reportRunAfter(uid: string, r: RunReport): void {
  if (r.passages.length === 0) return;
  const body = reportBody(uid, r);
  after(async () => {
    try {
      await post("/api/products/knowledge/report", body);
    } catch (err) {
      console.error(`[report] ${r.function} ${r.requestId} failed (credit not recorded)`, err);
    }
  });
}
