/**
 * Agent runs, stored in Plugent's Firestore: `users/{uid}/runs/{runId}` with the run's
 * turns under `turns/{turnId}`. Under the user's own path, so a run id from a URL can never
 * reach another user's run, and listing needs no composite index.
 *
 * ⚠️ ONLY THIS MODULE TOUCHES THE COLLECTIONS — every caller passes the session's uid.
 */
import "server-only";
import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import type { AskResult, AskSource } from "@/lib/agents/ask";
import type { AgentId } from "@/lib/agents/registry";
import { plugentDb } from "@/lib/firebase/admin";

export const MAX_TITLE_CHARS = 80;
const SIDEBAR_RUNS = 30;

export interface RunSummary {
  id: string;
  agent: AgentId;
  title: string;
  /** ms since epoch */
  updatedAt: number;
  tokensUsed: number;
  turnCount: number;
}

export type StoredTurn = {
  id: string;
  question: string;
  createdAt: number;
} & (
  | { kind: "answer"; answer: string; sources: AskSource[]; tokens: number; charged: boolean }
  | { kind: "not_covered"; tokens: number }
);

/** A Firestore auto id: what a run id from a URL or a request body must look like. */
export function isRunId(value: string): boolean {
  return /^[A-Za-z0-9]{20}$/.test(value);
}

function runs(uid: string) {
  return plugentDb().collection("users").doc(uid).collection("runs");
}

function millis(t: unknown): number {
  return t && typeof (t as Timestamp).toMillis === "function" ? (t as Timestamp).toMillis() : 0;
}

/** A question shortened to a title: one line, whole words, at most MAX_TITLE_CHARS. */
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= MAX_TITLE_CHARS) return line;
  const cut = line.slice(0, MAX_TITLE_CHARS - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export async function listRuns(uid: string): Promise<RunSummary[]> {
  const snap = await runs(uid).orderBy("updatedAt", "desc").limit(SIDEBAR_RUNS).get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      agent: data.agent,
      title: String(data.title ?? "Untitled"),
      updatedAt: millis(data.updatedAt),
      tokensUsed: Number(data.tokensUsed ?? 0),
      turnCount: Number(data.turnCount ?? 0),
    };
  });
}

export async function readRun(
  uid: string,
  runId: string,
): Promise<{ run: RunSummary; turns: StoredTurn[] } | null> {
  const ref = runs(uid).doc(runId);
  const [doc, turns] = await Promise.all([
    ref.get(),
    ref.collection("turns").orderBy("createdAt").get(),
  ]);
  if (!doc.exists) return null;
  const data = doc.data() ?? {};
  return {
    run: {
      id: doc.id,
      agent: data.agent,
      title: String(data.title ?? "Untitled"),
      updatedAt: millis(data.updatedAt),
      tokensUsed: Number(data.tokensUsed ?? 0),
      turnCount: Number(data.turnCount ?? 0),
    },
    turns: turns.docs.map((t) => {
      const d = t.data();
      const base = { id: t.id, question: String(d.question ?? ""), createdAt: millis(d.createdAt) };
      return d.kind === "answer"
        ? {
            ...base,
            kind: "answer" as const,
            answer: String(d.answer ?? ""),
            sources: Array.isArray(d.sources) ? d.sources : [],
            tokens: Number(d.tokens ?? 0),
            charged: d.charged !== false,
          }
        : { ...base, kind: "not_covered" as const, tokens: Number(d.tokens ?? 0) };
    }),
  };
}

export async function runExists(uid: string, runId: string): Promise<boolean> {
  return (await runs(uid).doc(runId).get()).exists;
}

/**
 * Saves one answered question: into `runId`, or into a new run titled from the question
 * when `runId` is null. Returns the run id. The run and its turn are written together.
 */
export async function saveTurn(
  uid: string,
  runId: string | null,
  agent: AgentId,
  question: string,
  result: AskResult,
): Promise<string> {
  const db = plugentDb();
  const runRef = runId ? runs(uid).doc(runId) : runs(uid).doc();
  const turnRef = runRef.collection("turns").doc();
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  if (runId) {
    batch.update(runRef, {
      updatedAt: now,
      tokensUsed: FieldValue.increment(result.tokens),
      turnCount: FieldValue.increment(1),
    });
  } else {
    batch.set(runRef, {
      agent,
      title: titleFrom(question),
      createdAt: now,
      updatedAt: now,
      tokensUsed: result.tokens,
      turnCount: 1,
    });
  }
  batch.set(
    turnRef,
    result.kind === "answer"
      ? {
          question,
          kind: "answer",
          answer: result.answer,
          sources: result.sources,
          tokens: result.tokens,
          charged: result.charged,
          createdAt: now,
        }
      : { question, kind: "not_covered", tokens: result.tokens, createdAt: now },
  );
  await batch.commit();
  return runRef.id;
}

/** false when the run does not exist (or is not this user's). */
export async function renameRun(uid: string, runId: string, title: string): Promise<boolean> {
  const ref = runs(uid).doc(runId);
  if (!(await ref.get()).exists) return false;
  await ref.update({ title });
  return true;
}

/** Deletes the run and every turn under it. */
export async function deleteRun(uid: string, runId: string): Promise<void> {
  await plugentDb().recursiveDelete(runs(uid).doc(runId));
}
