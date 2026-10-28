/**
 * POST /api/agents/ask — the Chat agent (`lib/agents/ask.ts`). Body `{question, runId?, mode?}`;
 * the user is the session's, never the body's. The answered question is saved into the
 * run (a new one when `runId` is absent).
 *
 * A refusal before any work (bad question, agent off, busy run, rate limit) is a plain JSON
 * error. Past that the answer STREAMS (audit F5) as NDJSON, one event a line:
 * `{type:"start", stopId}`, `{type:"delta", text}` while the model writes, then
 * `{type:"done", …result, runId, turnId}`, or `{type:"error", error, status}`.
 * ⚠️ STOP IS A SECOND REQUEST, not a closed connection: the composer's Stop posts the stopId to
 * `/api/agents/ask/stop`, which writes `users/{uid}/ask_stops/{stopId}`; this answer listens to
 * that document, stops the model, and still sends `done`, so the page learns the run and the
 * exact saved text. What the model wrote is the answer, charged and saved. A reader that goes
 * away (closed tab) stops the model the same way.
 * ⚠️ THE WORK OUTLIVES THE RESPONSE: it runs under `after()`, so the charge and the save happen
 * even when the reader has gone.
 */
import { randomUUID } from "node:crypto";
import { after, type NextRequest, NextResponse } from "next/server";
import { AskRefused, HISTORY_MESSAGES, MAX_QUESTION_CHARS, runAsk } from "@/lib/agents/ask";
import { askStopRef } from "@/lib/ask-stop";
import { getSessionUser } from "@/lib/auth/session";
import { readPrefs } from "@/lib/prefs";
import { consumeRateLimit } from "@/lib/rate-limit";
import { claimRun, historyFrom, isRunId, readRun, releaseRun, saveTurn } from "@/lib/runs";
import { SebtemberApiError } from "@/lib/sebtember/products";
import { retryUnpaid } from "@/lib/unpaid";

export const runtime = "nodejs";
// Far above the model's own timeout (75 s deep), so the charge and the save always get to run.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (question.length === 0 || question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json({ error: "invalid_question" }, { status: 400 });
  }
  // Turned off on All agents: refused before any money is spent. A failed read refuses too.
  const prefs = await readPrefs(user.uid).catch(() => null);
  if (!prefs) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  if (prefs.disabledAgents.includes("chat")) {
    return NextResponse.json({ error: "agent_off" }, { status: 403 });
  }
  const mode = body?.mode === "deep" ? "deep" : "standard";
  const runId = body?.runId == null ? null : String(body.runId);
  // Checked before any money is spent: a stale or foreign run id is refused for free, and the
  // run is claimed, so a second question in the same chat waits for the first.
  if (runId !== null) {
    const claim = isRunId(runId) ? await claimRun(user.uid, runId, "chat") : null;
    if (claim === null) return NextResponse.json({ error: "run_not_found" }, { status: 404 });
    if (claim === "busy") return NextResponse.json({ error: "busy" }, { status: 409 });
  }
  if (!(await consumeRateLimit(user.uid, "agents"))) {
    if (runId) await releaseRun(user.uid, runId);
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const uid = user.uid;
  const encoder = new TextEncoder();
  // Stop: the Stop document appeared, or the reader cancelled the stream (closed the tab).
  // Not `req.signal`: what it reports after the handler returns differs by runtime.
  const stop = new AbortController();
  // Mutable box: TypeScript cannot see the stream's start() assign a plain `let`.
  const sink: { out: ReadableStreamDefaultController<Uint8Array> | null } = { out: null };
  const send = (event: object) => {
    if (!sink.out) return;
    try {
      sink.out.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    } catch {
      sink.out = null; // the reader has gone; the work carries on
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sink.out = controller;
    },
    cancel() {
      sink.out = null;
      stop.abort();
    },
  });

  const stopRef = askStopRef(uid, randomUUID());
  const unlisten = stopRef.onSnapshot(
    (snap) => snap.exists && stop.abort(),
    (err) => console.warn("[ask] stop listener", err),
  );
  send({ type: "start", stopId: stopRef.id });
  const work = (async () => {
    const event = await answer(uid, question, mode, runId, stop.signal, (text) =>
      send({ type: "delta", text }),
    );
    unlisten();
    await stopRef.delete().catch(() => {});
    send(event);
    try {
      sink.out?.close();
    } catch {
      // already closed by the reader
    }
    // A charge an earlier run could not make is paid now, after this answer.
    await retryUnpaid(uid, 5).catch((err) => console.error("[unpaid] retry", err));
  })();
  after(work);
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

/** The answer's work, past every free check: the final event the stream ends with. */
async function answer(
  uid: string,
  question: string,
  mode: "standard" | "deep",
  runId: string | null,
  stop: AbortSignal,
  onDelta: (text: string) => void,
): Promise<object> {
  const user = { uid };
  try {
    // The run's earlier turns are the conversation the model continues (sebtember chat's last
    // 10 messages).
    const run = runId ? await readRun(user.uid, runId) : null;
    const history = run ? historyFrom(run.turns, HISTORY_MESSAGES) : [];
    const result = await runAsk(user.uid, question, mode, history, { onDelta, stop });
    // The answer is paid for, so a failed save still returns it, without a run id.
    const saved = await saveTurn(user.uid, runId, "chat", question, result).catch(async (err) => {
      console.error(`[ask] save failed uid=${user.uid}`, err);
      if (runId) await releaseRun(user.uid, runId);
      return null;
    });
    return {
      type: "done",
      ...result,
      runId: saved?.runId ?? null,
      turnId: saved?.turnId ?? null,
    };
  } catch (err) {
    if (runId) await releaseRun(user.uid, runId);
    if (err instanceof AskRefused) return { type: "error", error: err.code, status: 403 };
    if (err instanceof SebtemberApiError) {
      console.error("[ask] sebtember", err.status, err.code);
      if (err.status === 429) return { type: "error", error: "rate_limited", status: 429 };
      return { type: "error", error: err.code, status: 502 };
    }
    console.error("[ask]", err);
    return { type: "error", error: "answer_failed", status: 502 };
  }
}
