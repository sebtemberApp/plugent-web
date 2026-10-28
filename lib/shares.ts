/**
 * Shared answers (audit F1): a public, read-only page at `/a/{token}` for ONE answer, as
 * Sebtember's `shared_answers` (its Step 356). Share is per answer only, never a whole run.
 *
 * ⚠️ A SNAPSHOT, NOT LIVE. `shareAnswer` freezes the question, the answer and its citations
 * into `shared_answers/{token}` from the STORED turn (the client sends only its id),
 * so a later follow-up in the same run can never reach the public page.
 * ⚠️ CITATIONS ONLY: file name, page and the content owner's name. No catalogue name (a
 * private catalogue's name can say more than its owner meant), no passage text, no download.
 * ⚠️ STOPPING A SHARE DELETES THE SNAPSHOT (not a flag), so the page 404s and nothing stays.
 * Deleting the run stops every share of its answers (`stopRunShares`). Account deletion (F8)
 * must also delete `shared_answers` where `owner_uid` is the user: the snapshot lives outside
 * `users/{uid}`.
 *
 * `users/{uid}/shares/{runId}_{turnId}` points at a live token, so sharing the same answer
 * twice gives the same link, and a run's shares are found without a composite index.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { AgentId } from "@/lib/agents/registry";
import { plugentDb } from "@/lib/firebase/admin";
import { readRun } from "@/lib/runs";
import { getProfile } from "@/lib/sebtember/products";

const SHARES = "shared_answers";
/** The agents whose answers can be shared: the thread agents with an answer card. */
const SHAREABLE: readonly AgentId[] = ["chat", "specification", "quotation"];
const MAX_SOURCES = 12;

export interface SharedSource {
  n: number;
  fileName: string;
  page: string | null;
  /** The content owner's name, when known. */
  owner: string | null;
  /** Another user's published (Library) catalogue. */
  library: boolean;
}

/** What the public page shows. `owner_uid`, `run_id` and `turn_id` are never rendered. */
export interface SharedAnswer {
  token: string;
  agent: AgentId;
  question: string;
  answer: string;
  sources: SharedSource[];
  /** ms since epoch */
  createdAt: number;
}

/** 16 random bytes, URL-safe: what a token from a URL must look like. */
export function isShareToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(value);
}

/** Sebtember's Step-380 rule: only a substantive, cited answer is offered to search engines. */
export function isIndexable(share: SharedAnswer): boolean {
  return share.answer.length >= 200 && share.sources.length >= 1;
}

function pointers(uid: string) {
  return plugentDb().collection("users").doc(uid).collection("shares");
}

/** The run's stored answer turn `turnId` (not a clarifying question, not "not covered"). */
async function findTurn(uid: string, runId: string, turnId: string) {
  const run = await readRun(uid, runId);
  if (!run || !SHAREABLE.includes(run.run.agent)) return null;
  const turn = run.turns.find((t) => t.id === turnId && t.kind === "answer" && !t.clarify);
  return turn?.kind === "answer" ? { agent: run.run.agent, turn } : null;
}

/** The live link of an answer, if it is shared; null otherwise (or when it is not found). */
export async function shareTokenOf(
  uid: string,
  runId: string,
  turnId: string,
): Promise<string | null> {
  const found = await findTurn(uid, runId, turnId);
  if (!found) return null;
  const doc = await pointers(uid).doc(`${runId}_${found.turn.id}`).get();
  const token = doc.get("token");
  return typeof token === "string" ? token : null;
}

/** Shares one of the user's stored answers; the same answer shared again keeps its token.
 *  null when the run or the answer is not the user's (or cannot be shared). */
export async function shareAnswer(
  uid: string,
  runId: string,
  turnId: string,
): Promise<string | null> {
  const found = await findTurn(uid, runId, turnId);
  if (!found) return null;
  const { agent, turn } = found;
  const pointer = pointers(uid).doc(`${runId}_${turn.id}`);
  const existing = (await pointer.get()).get("token");
  if (typeof existing === "string") return existing;

  // The user's own documents are credited to their Sebtember name, as Sebtember's page does.
  // Fail-open: without it, their sources carry no owner.
  const self = await getProfile(uid)
    .then((p) => p.display_name?.trim() || null)
    .catch(() => null);
  const sources: SharedSource[] = turn.sources.slice(0, MAX_SOURCES).map((s) => ({
    n: s.n,
    fileName: s.fileName,
    page: s.page,
    owner: s.owner === undefined || s.owner === null ? (s.library ? null : self) : s.owner,
    library: Boolean(s.library),
  }));
  const token = randomBytes(16).toString("base64url");
  const db = plugentDb();
  await db.runTransaction(async (tx) => {
    const again = await tx.get(pointer);
    if (typeof again.get("token") === "string") return;
    tx.set(db.collection(SHARES).doc(token), {
      owner_uid: uid,
      run_id: runId,
      turn_id: turn.id,
      agent,
      question: turn.question,
      answer: turn.answer,
      sources,
      created_at: FieldValue.serverTimestamp(),
    });
    tx.set(pointer, { token, run_id: runId, created_at: FieldValue.serverTimestamp() });
  });
  // A second tab may have won the transaction: its token is the answer's link.
  const settled = (await pointer.get()).get("token");
  return typeof settled === "string" ? settled : token;
}

/** Stops sharing one of the user's answers: the snapshot is deleted and the page 404s. */
export async function stopSharing(uid: string, token: string): Promise<boolean> {
  const db = plugentDb();
  const ref = db.collection(SHARES).doc(token);
  const snap = await ref.get();
  if (!snap.exists || snap.get("owner_uid") !== uid) return false;
  const batch = db.batch();
  batch.delete(ref);
  batch.delete(pointers(uid).doc(`${snap.get("run_id")}_${snap.get("turn_id")}`));
  await batch.commit();
  return true;
}

/** Stops every share of a run's answers: called when the run is deleted. */
export async function stopRunShares(uid: string, runId: string): Promise<void> {
  const db = plugentDb();
  const snap = await pointers(uid).where("run_id", "==", runId).get();
  if (snap.empty) return;
  const batch = db.batch();
  for (const d of snap.docs) {
    const token = d.get("token");
    if (typeof token === "string") batch.delete(db.collection(SHARES).doc(token));
    batch.delete(d.ref);
  }
  await batch.commit();
}

/** The public page's read: the snapshot, or null when it is gone. */
export async function readShare(token: string): Promise<SharedAnswer | null> {
  if (!isShareToken(token)) return null;
  const snap = await plugentDb().collection(SHARES).doc(token).get();
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  const created = d.created_at;
  return {
    token,
    agent: d.agent,
    question: String(d.question ?? ""),
    answer: String(d.answer ?? ""),
    sources: Array.isArray(d.sources) ? d.sources : [],
    createdAt: created instanceof Timestamp ? created.toMillis() : 0,
  };
}
