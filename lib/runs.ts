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
import type { StepData, StepOutcomeKind } from "@/lib/agents/troubleshoot-prompts";
import { plugentDb } from "@/lib/firebase/admin";
import type { ChargeUsage } from "@/lib/sebtember/products";

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
 * The run's agent and the text its first turn started with (a specification's subject),
 * or null when the run does not exist (or is not this user's).
 */
export async function runStart(
  uid: string,
  runId: string,
): Promise<{ agent: AgentId; first: string | null } | null> {
  const ref = runs(uid).doc(runId);
  const [doc, first] = await Promise.all([
    ref.get(),
    ref.collection("turns").orderBy("createdAt").limit(1).get(),
  ]);
  if (!doc.exists) return null;
  const question = first.docs[0]?.get("question");
  return { agent: doc.get("agent"), first: typeof question === "string" ? question : null };
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
          // The raw model usage behind the answer (model, input, output): the record of it.
          ...(result.usage ? { usage: result.usage } : {}),
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

/* ------------------------------------------------------------- troubleshooting */

/**
 * A Troubleshooting run keeps its state on the run document (`ts`) and its thread as
 * turns ordered by `seq` (several turns are written in one batch, so a server timestamp
 * cannot order them). A photo the user sent is kept once, at the size the model reads it,
 * under `photos/`, so later steps still see it; the turn holds only a small thumbnail.
 */
export type TsStatus = "draft" | "clarifying" | "stepping" | "resolved" | "exhausted";

export interface TsState {
  /** The first description plus every clarifying answer: the search query. */
  problem: string;
  status: TsStatus;
  clarifyCount: number;
  stepCount: number;
}

export type TsTurnBody =
  | {
      role: "user";
      text: string;
      /** A small JPEG data URL of the photo sent with this turn. */
      thumb: string | null;
      outcome: { stepId: string; kind: StepOutcomeKind; label: string } | null;
    }
  | { role: "clarify"; question: string; options: string[] }
  | { role: "context" }
  | {
      role: "step";
      step: StepData;
      sources: AskSource[];
      done: { kind: StepOutcomeKind; label: string } | null;
      tokens: number;
    }
  | {
      role: "end";
      result: "resolved" | "exhausted";
      summary: string;
      sources: AskSource[];
      tokens: number;
    };

export type TsTurn = TsTurnBody & { id: string; seq: number };

/** A turn in flight longer than this is a crashed request, not a live one (route: 120 s). */
const TS_STALE_MS = 150_000;

export const TS_NEW_STATE: TsState = {
  problem: "",
  status: "draft",
  clarifyCount: 0,
  stepCount: 0,
};

function tsState(raw: unknown): TsState {
  const t = (raw ?? {}) as Record<string, unknown>;
  const status = ["draft", "clarifying", "stepping", "resolved", "exhausted"].includes(
    t.status as string,
  )
    ? (t.status as TsStatus)
    : "draft";
  return {
    problem: typeof t.problem === "string" ? t.problem : "",
    status,
    clarifyCount: Number(t.clarifyCount ?? 0),
    stepCount: Number(t.stepCount ?? 0),
  };
}

export async function readTsRun(
  uid: string,
  runId: string,
): Promise<{ run: RunSummary; state: TsState; turns: TsTurn[] } | null> {
  const ref = runs(uid).doc(runId);
  const [doc, turns] = await Promise.all([ref.get(), ref.collection("turns").orderBy("seq").get()]);
  if (!doc.exists || doc.get("agent") !== "troubleshooting") return null;
  const data = doc.data() ?? {};
  return {
    run: {
      id: doc.id,
      agent: "troubleshooting",
      title: String(data.title ?? "Untitled"),
      updatedAt: millis(data.updatedAt),
      tokensUsed: Number(data.tokensUsed ?? 0),
      turnCount: Number(data.turnCount ?? 0),
    },
    state: tsState(data.ts),
    turns: turns.docs.map((t) => {
      const { createdAt: _c, ...rest } = t.data();
      return { ...(rest as TsTurnBody), id: t.id, seq: Number(rest.seq ?? 0) };
    }),
  };
}

/**
 * Claims an existing Troubleshooting run for one request, so a double submit cannot run
 * two turns at once. null when the run does not exist, is not this user's or another
 * agent's; "busy" while another request holds it.
 */
export async function claimTsRun(uid: string, runId: string): Promise<TsState | "busy" | null> {
  const ref = runs(uid).doc(runId);
  return plugentDb().runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists || doc.get("agent") !== "troubleshooting") return null;
    const running = doc.get("running");
    if (running && Date.now() - millis(running) < TS_STALE_MS) return "busy";
    tx.update(ref, { running: FieldValue.serverTimestamp() });
    return tsState(doc.get("ts"));
  });
}

export async function releaseTsRun(uid: string, runId: string): Promise<void> {
  await runs(uid)
    .doc(runId)
    .update({ running: FieldValue.delete() })
    .catch((err) => console.error("[troubleshooting] release failed", err));
}

/** The latest photo sent in the run, as the model reads it, or null. */
export async function readTsPhoto(
  uid: string,
  runId: string,
): Promise<{ mediaType: string; data: string } | null> {
  const snap = await runs(uid)
    .doc(runId)
    .collection("photos")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  const d = snap.docs[0]?.data();
  return d && typeof d.data === "string" ? { mediaType: String(d.mediaType), data: d.data } : null;
}

/**
 * Writes one request's turns and the run's new state together, and releases the claim.
 * A new run (runId null) is created here, titled `title`. Returns the run id and the ids
 * given to the turns, in order.
 */
export async function commitTsTurns(
  uid: string,
  runId: string | null,
  args: {
    title: string;
    state: TsState;
    tokens: number;
    turns: TsTurnBody[];
    /** The step the user just answered, collapsed to its outcome. */
    stepDone: { stepId: string; kind: StepOutcomeKind; label: string } | null;
    photo: { mediaType: string; data: string } | null;
    nextSeq: number;
    /** The request's model calls, raw counts: kept on its last turn. */
    usage?: ChargeUsage[];
  },
): Promise<{ runId: string; turnIds: string[] }> {
  const db = plugentDb();
  const runRef = runId ? runs(uid).doc(runId) : runs(uid).doc();
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  if (runId) {
    batch.update(runRef, {
      ts: args.state,
      updatedAt: now,
      tokensUsed: FieldValue.increment(args.tokens),
      turnCount: FieldValue.increment(1),
      running: FieldValue.delete(),
    });
  } else {
    batch.set(runRef, {
      agent: "troubleshooting",
      title: titleFrom(args.title),
      ts: args.state,
      createdAt: now,
      updatedAt: now,
      tokensUsed: args.tokens,
      turnCount: 1,
    });
  }
  if (args.stepDone) {
    batch.update(runRef.collection("turns").doc(args.stepDone.stepId), {
      done: { kind: args.stepDone.kind, label: args.stepDone.label },
    });
  }
  const turnIds = args.turns.map((turn, i) => {
    const ref = runRef.collection("turns").doc();
    const last = i === args.turns.length - 1 && args.usage?.length;
    batch.set(ref, {
      ...turn,
      seq: args.nextSeq + i,
      ...(last ? { usage: args.usage } : {}),
      createdAt: now,
    });
    return ref.id;
  });
  if (args.photo) {
    batch.set(runRef.collection("photos").doc(), { ...args.photo, createdAt: now });
  }
  await batch.commit();
  return { runId: runRef.id, turnIds };
}

/* --------------------------------------------------------------------- pricing */

/**
 * A Pricing run lives in SEBTEMBER (`pricings/{id}`, the engine's own document); Plugent's run is
 * its sidebar row: the title, the sebtember id, the wallet the balance call returned (never
 * re-resolved), and one `charge` turn per step that sebtember charged, with its model usage.
 */
export interface PricingRunRef {
  title: string;
  pricingId: string;
  source: string;
}

export async function createPricingRun(uid: string, ref: PricingRunRef): Promise<string> {
  const doc = runs(uid).doc();
  const now = FieldValue.serverTimestamp();
  await doc.set({
    agent: "pricing",
    title: titleFrom(ref.title),
    pricingId: ref.pricingId,
    source: ref.source,
    createdAt: now,
    updatedAt: now,
    tokensUsed: 0,
    turnCount: 0,
  });
  return doc.id;
}

export async function readPricingRun(uid: string, runId: string): Promise<PricingRunRef | null> {
  const doc = await runs(uid).doc(runId).get();
  if (!doc.exists || doc.get("agent") !== "pricing") return null;
  const pricingId = doc.get("pricingId");
  if (typeof pricingId !== "string" || !pricingId) return null;
  return {
    title: String(doc.get("title") ?? "Untitled"),
    pricingId,
    source: String(doc.get("source") ?? "personal"),
  };
}

/** One step sebtember charged: kept as a turn (with its usage) and added to the run's total. */
export async function recordPricingCharge(
  uid: string,
  runId: string,
  step: "extract" | "match",
  lineId: string,
  charge: { tokens: number; usage?: ChargeUsage[] },
): Promise<void> {
  const ref = runs(uid).doc(runId);
  const now = FieldValue.serverTimestamp();
  const batch = plugentDb().batch();
  // The line id is the turn id, so a retried step that sebtember reports again is one turn.
  batch.set(ref.collection("turns").doc(lineId), {
    kind: "charge",
    step,
    by: "sebtember",
    tokens: charge.tokens,
    ...(charge.usage?.length ? { usage: charge.usage } : {}),
    createdAt: now,
  });
  batch.update(ref, {
    tokensUsed: FieldValue.increment(charge.tokens),
    turnCount: FieldValue.increment(1),
    updatedAt: now,
  });
  await batch.commit();
}

export async function touchRun(uid: string, runId: string, title?: string): Promise<void> {
  await runs(uid)
    .doc(runId)
    .update({
      updatedAt: FieldValue.serverTimestamp(),
      ...(title ? { title: titleFrom(title) } : {}),
    });
}
