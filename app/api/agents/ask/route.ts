/**
 * POST /api/agents/ask — the Chat agent (`lib/agents/ask.ts`). Body `{question, runId?, mode?}`;
 * the user is the session's, never the body's. The answered question is saved into the
 * run (a new one when `runId` is absent) and the response carries its `runId`.
 */
import { type NextRequest, NextResponse } from "next/server";
import { AskRefused, MAX_QUESTION_CHARS, runAsk } from "@/lib/agents/ask";
import { getSessionUser } from "@/lib/auth/session";
import { readPrefs } from "@/lib/prefs";
import { isRunId, runExists, saveTurn } from "@/lib/runs";
import { SebtemberApiError } from "@/lib/sebtember/products";

export const runtime = "nodejs";
export const maxDuration = 90;

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
  // Checked before any money is spent: a stale or foreign run id is refused for free.
  if (runId !== null && !(isRunId(runId) && (await runExists(user.uid, runId)))) {
    return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  }
  try {
    const result = await runAsk(user.uid, question, mode);
    // The answer is paid for, so a failed save still returns it, without a run id.
    const savedRunId = await saveTurn(user.uid, runId, "chat", question, result).catch((err) => {
      console.error(`[ask] save failed uid=${user.uid}`, err);
      return null;
    });
    return NextResponse.json({ ...result, runId: savedRunId });
  } catch (err) {
    if (err instanceof AskRefused) {
      return NextResponse.json({ error: err.code }, { status: 403 });
    }
    if (err instanceof SebtemberApiError) {
      console.error("[ask] sebtember", err.status, err.code);
      return NextResponse.json({ error: err.code }, { status: 502 });
    }
    console.error("[ask]", err);
    return NextResponse.json({ error: "answer_failed" }, { status: 502 });
  }
}
