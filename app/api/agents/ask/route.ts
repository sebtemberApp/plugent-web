/**
 * POST /api/agents/ask — the Ask agent (`lib/agents/ask.ts`). Body `{question}`; the user
 * is the session's, never the body's.
 */
import { type NextRequest, NextResponse } from "next/server";
import { AskRefused, MAX_QUESTION_CHARS, runAsk } from "@/lib/agents/ask";
import { getSessionUser } from "@/lib/auth/session";
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
  try {
    return NextResponse.json(await runAsk(user.uid, question));
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
