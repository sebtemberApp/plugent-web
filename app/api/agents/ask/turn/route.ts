/**
 * POST /api/agents/ask/turn — where a Chat answer stands, for a page whose stream dropped
 * (audit N1). Body `{runId, turnId}`: the ids the answer's `start` event named; the user is the
 * session's, so only their own answer can be read. `{status: "done", turn, title}` once it is
 * saved, `"writing"` while the model works, `"failed"` with the reason, `"missing"` when there
 * is no such answer.
 */
import { type NextRequest, NextResponse } from "next/server";
import { askPendingRef } from "@/lib/ask-stop";
import { getSessionUser } from "@/lib/auth/session";
import { isRunId, readTurn } from "@/lib/runs";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const runId = typeof body?.runId === "string" ? body.runId : "";
  const turnId = typeof body?.turnId === "string" ? body.turnId : "";
  if (!isRunId(runId) || !isRunId(turnId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const [saved, pending] = await Promise.all([
    readTurn(user.uid, runId, turnId),
    askPendingRef(user.uid, turnId).get(),
  ]);
  if (saved) return NextResponse.json({ status: "done", ...saved });
  if (pending.exists) {
    const error = pending.get("error");
    return NextResponse.json(
      typeof error === "string" ? { status: "failed", error } : { status: "writing" },
    );
  }
  return NextResponse.json({ status: "missing" });
}
