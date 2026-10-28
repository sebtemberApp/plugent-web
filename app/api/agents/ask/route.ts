/**
 * POST /api/agents/ask — the Chat agent (`lib/agents/ask.ts`). Body `{question, runId?, mode?}`;
 * the user is the session's, never the body's. The answered question is saved into the
 * run (a new one when `runId` is absent) and the response carries its `runId`.
 */
import { after, type NextRequest, NextResponse } from "next/server";
import { AskRefused, HISTORY_MESSAGES, MAX_QUESTION_CHARS, runAsk } from "@/lib/agents/ask";
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
  // A charge an earlier run could not make is paid now, after this response.
  after(() => retryUnpaid(user.uid, 5).catch((err) => console.error("[unpaid] retry", err)));
  try {
    // The run's earlier turns are the conversation the model continues (sebtember chat's last
    // 10 messages).
    const run = runId ? await readRun(user.uid, runId) : null;
    const history = run ? historyFrom(run.turns, HISTORY_MESSAGES) : [];
    const result = await runAsk(user.uid, question, mode, history);
    // The answer is paid for, so a failed save still returns it, without a run id.
    const saved = await saveTurn(user.uid, runId, "chat", question, result).catch(async (err) => {
      console.error(`[ask] save failed uid=${user.uid}`, err);
      if (runId) await releaseRun(user.uid, runId);
      return null;
    });
    return NextResponse.json({
      ...result,
      runId: saved?.runId ?? null,
      turnId: saved?.turnId ?? null,
    });
  } catch (err) {
    if (runId) await releaseRun(user.uid, runId);
    if (err instanceof AskRefused) {
      return NextResponse.json({ error: err.code }, { status: 403 });
    }
    if (err instanceof SebtemberApiError) {
      console.error("[ask] sebtember", err.status, err.code);
      if (err.status === 429) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
      return NextResponse.json({ error: err.code }, { status: 502 });
    }
    console.error("[ask]", err);
    return NextResponse.json({ error: "answer_failed" }, { status: 502 });
  }
}
