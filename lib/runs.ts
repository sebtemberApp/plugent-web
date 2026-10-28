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
import type { TurnCharge } from "@/lib/usage";

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
  | {
      kind: "answer";
      answer: string;
      sources: AskSource[];
      tokens: number;
      charged: boolean;
      /** Chat asked a clarifying question (`answer` is the question): its chips. */
      clarify?: { question: string; options: string[] };
    }
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
            ...(d.clarify && Array.isArray(d.clarify.options)
              ? {
                  clarify: {
                    question: String(d.clarify.question ?? ""),
                    options: d.clarify.options.map(String),
                  },
                }
              : {}),
          }
        : { ...base, kind: "not_covered" as const, tokens: Number(d.tokens ?? 0) };
    }),
  };
}

/**
 * A chat's earlier messages for the model, oldest first: each question and what was answered
 * (a clarifying question counts as the answer), at most `limit` messages. A question the
 * catalogues did not cover is answered with the sentence the user saw.
 */
export function historyFrom(
  turns: StoredTurn[],
  limit: number,
): { role: "user" | "assistant"; content: string }[] {
  return turns
    .flatMap((t) => [
      { role: "user" as const, content: t.question },
      {
        role: "assistant" as const,
        content:
          t.kind === "answer" ? t.answer : "Your catalogues don't seem to cover this question.",
      },
    ])
    .slice(-limit);
}

export async function runExists(uid: string, runId: string): Promise<boolean> {
  return (await runs(uid).doc(runId).get()).exists;
}

/** Longer than any agent route's `maxDuration` (300 s), so a live request is never read as dead. */
const RUN_STALE_MS = 330_000;

/**
 * Claims an existing run of `agent` for one request, so two quick questions in one thread cannot
 * run at once on the same history (audit B4). The run's start, as `runStart` reads it; null when
 * the run does not exist, is not this user's or is another agent's; "busy" while another request
 * holds it. `saveTurn` releases the claim, and so does `releaseRun` on a failure.
 */
export async function claimRun(
  uid: string,
  runId: string,
  agent: AgentId,
): Promise<{ first: string | null } | "busy" | null> {
  const ref = runs(uid).doc(runId);
  const first = await ref.collection("turns").orderBy("createdAt").limit(1).get();
  return plugentDb().runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists || doc.get("agent") !== agent) return null;
    const running = doc.get("running");
    if (running && Date.now() - millis(running) < RUN_STALE_MS) return "busy";
    tx.update(ref, { running: FieldValue.serverTimestamp() });
    const question = first.docs[0]?.get("question");
    return { first: typeof question === "string" ? question : null };
  });
}

export async function releaseRun(uid: string, runId: string): Promise<void> {
  await runs(uid)
    .doc(runId)
    .update({ running: FieldValue.delete() })
    .catch((err) => console.error("[runs] release failed", err));
}

/**
 * Saves one answered question: into `runId`, or into a new run titled from the question
 * when `runId` is null. Returns the run id and the turn's. The run and its turn are written
 * together, and the run's claim (`claimRun`) is released with them.
 */
export async function saveTurn(
  uid: string,
  runId: string | null,
  agent: AgentId,
  question: string,
  result: AskResult,
): Promise<{ runId: string; turnId: string }> {
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
      running: FieldValue.delete(),
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
          ...(result.charges?.length ? { charges: result.charges } : {}),
          ...(result.clarify ? { clarify: result.clarify } : {}),
          createdAt: now,
        }
      : {
          question,
          kind: "not_covered",
          tokens: result.tokens,
          ...(result.charges?.length ? { charges: result.charges } : {}),
          createdAt: now,
        },
  );
  await batch.commit();
  return { runId: runRef.id, turnId: turnRef.id };
}

/**
 * One stored turn as feedback quotes it: the run's agent, and the question and answer as the
 * user saw them. null when the run or the turn is not this user's.
 */
export async function readTurnForFeedback(
  uid: string,
  runId: string,
  turnId: string | null,
): Promise<{ agent: AgentId; question: string | null; answer: string | null } | null> {
  const ref = runs(uid).doc(runId);
  const [doc, turn] = await Promise.all([
    ref.get(),
    turnId && isRunId(turnId) ? ref.collection("turns").doc(turnId).get() : null,
  ]);
  if (!doc.exists) return null;
  const agent = doc.get("agent") as AgentId;
  const d = turn?.exists ? (turn.data() ?? {}) : null;
  if (!d) return { agent, question: null, answer: null };
  if (d.role === "step") {
    const step = d.step ?? {};
    return {
      agent,
      question: String(step.title ?? ""),
      answer: `${step.title ?? ""}\n${step.instruction ?? ""}`,
    };
  }
  if (d.role === "end") {
    return { agent, question: "Troubleshooting result", answer: String(d.summary ?? "") };
  }
  if (d.role === "clarify") return { agent, question: null, answer: String(d.question ?? "") };
  return { agent, question: String(d.question ?? ""), answer: String(d.answer ?? "") };
}

/** false when the run does not exist (or is not this user's). */
export async function renameRun(uid: string, runId: string, title: string): Promise<boolean> {
  const ref = runs(uid).doc(runId);
  if (!(await ref.get()).exists) return false;
  await ref.update({ title });
  return true;
}

/**
 * Deletes the run and every turn under it. What its turns charged is kept first, as one
 * `deleted_runs/{runId}` record (no question, no answer), so the Usage page still shows what the
 * wallet really paid (audit B11).
 */
export async function deleteRun(uid: string, runId: string): Promise<void> {
  const ref = runs(uid).doc(runId);
  const [doc, turns] = await Promise.all([ref.get(), ref.collection("turns").get()]);
  if (doc.exists) {
    const spent = turns.docs.flatMap((t): Spent[] => {
      const at = millis(t.get("createdAt"));
      const charges = t.get("charges");
      if (Array.isArray(charges) && charges.length > 0) return [{ at, charges }];
      const tokens = Number(t.get("tokens") ?? 0);
      return tokens > 0 ? [{ at, tokens }] : [];
    });
    if (spent.length > 0) {
      await deletedRuns(uid)
        .doc(runId)
        .set({
          agent: doc.get("agent"),
          title: String(doc.get("title") ?? "Untitled"),
          updatedAt: doc.get("updatedAt") ?? FieldValue.serverTimestamp(),
          deletedAt: FieldValue.serverTimestamp(),
          spent,
        });
    }
  }
  await plugentDb().recursiveDelete(ref);
}

function deletedRuns(uid: string) {
  return plugentDb().collection("users").doc(uid).collection("deleted_runs");
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

/** A turn in flight longer than this is a crashed request, not a live one (route: 300 s). */
const TS_STALE_MS = 330_000;

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
    /** What the request cost, line by line: kept on its last turn (the Usage page). */
    charges?: TurnCharge[];
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
    const last = i === args.turns.length - 1;
    batch.set(ref, {
      ...turn,
      seq: args.nextSeq + i,
      ...(last && args.usage?.length ? { usage: args.usage } : {}),
      ...(last && args.charges?.length ? { charges: args.charges } : {}),
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
    charges: [
      {
        line: lineId,
        by: "sebtember",
        what: step === "extract" ? "Reading the file" : "Matching and pricing",
        tokens: charge.tokens,
        ...(charge.usage?.length ? { usage: charge.usage } : {}),
      } satisfies TurnCharge,
    ],
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

/* ----------------------------------------------------------------------- usage */

/** One run's charges inside a period, for the Usage page. */
export interface UsageRun {
  id: string;
  agent: AgentId;
  title: string;
  /** ms since epoch: the run's latest charge inside the period. */
  lastAt: number;
  charges: Array<TurnCharge & { at: number }>;
  /** Tokens charged before turns kept their lines: a total that cannot be split. */
  unsplit: number;
  /** The run was deleted: its charges are kept, its content is not. */
  deleted: boolean;
}

const USAGE_RUNS = 200;

/** What one turn cost: its lines, or a bare total from before turns kept them. */
type Spent = { at: number; charges?: unknown; tokens?: unknown };

function usageRun(
  id: string,
  meta: { agent: AgentId; title: string; deleted: boolean },
  spent: Spent[],
  inWindow: (at: number) => boolean,
): UsageRun | null {
  const charges: UsageRun["charges"] = [];
  let unsplit = 0;
  let lastAt = 0;
  for (const t of spent) {
    if (!inWindow(t.at)) continue;
    if (Array.isArray(t.charges)) {
      for (const c of t.charges as TurnCharge[]) {
        if (!(Number(c?.tokens) > 0)) continue;
        charges.push({ ...c, tokens: Number(c.tokens), at: t.at });
        lastAt = Math.max(lastAt, t.at);
      }
      continue;
    }
    const tokens = Number(t.tokens ?? 0);
    if (tokens > 0) {
      unsplit += tokens;
      lastAt = Math.max(lastAt, t.at);
    }
  }
  if (charges.length === 0 && unsplit === 0) return null;
  charges.sort((a, b) => a.at - b.at);
  return { id, ...meta, lastAt, charges, unsplit };
}

/**
 * Every run with a charge in `[since, until)` (null = unbounded), each with its charges in that
 * window, newest run first; deleted runs come from their `deleted_runs` record. A turn written
 * before `charges` existed counts its `tokens` as `unsplit`: the total is real, who charged it is
 * not recorded.
 */
export async function readUsage(
  uid: string,
  since: number | null,
  until: number | null,
): Promise<{ runs: UsageRun[]; truncated: boolean }> {
  const window = <T extends FirebaseFirestore.Query>(q: T) =>
    (since !== null ? q.where("updatedAt", ">=", new Date(since)) : q)
      .orderBy("updatedAt", "desc")
      .limit(USAGE_RUNS);
  const [live, gone] = await Promise.all([window(runs(uid)).get(), window(deletedRuns(uid)).get()]);
  const inWindow = (at: number) =>
    (since === null || at >= since) && (until === null || at < until);
  const read = await Promise.all([
    ...live.docs.map(async (doc) => {
      const turns = await doc.ref.collection("turns").get();
      return usageRun(
        doc.id,
        { agent: doc.get("agent"), title: String(doc.get("title") ?? "Untitled"), deleted: false },
        turns.docs.map((t) => ({
          at: millis(t.get("createdAt")),
          charges: t.get("charges"),
          tokens: t.get("tokens"),
        })),
        inWindow,
      );
    }),
    ...gone.docs.map(async (doc) =>
      usageRun(
        doc.id,
        { agent: doc.get("agent"), title: String(doc.get("title") ?? "Untitled"), deleted: true },
        Array.isArray(doc.get("spent")) ? (doc.get("spent") as Spent[]) : [],
        inWindow,
      ),
    ),
  ]);
  return {
    runs: read.filter((r): r is UsageRun => r !== null).sort((a, b) => b.lastAt - a.lastAt),
    truncated: live.size === USAGE_RUNS || gone.size === USAGE_RUNS,
  };
}
