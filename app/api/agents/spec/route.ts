/**
 * POST /api/agents/spec — the Specification and Quotation agents (`lib/agents/specdoc.ts`).
 * Body `{agent: "specification" | "quotation", text, runId?}`; the user is the session's,
 * never the body's. A new run's text is its SUBJECT; in an existing run it is a refinement
 * of the subject the run started with, which is read from the stored run, never the body.
 */
import { type NextRequest, NextResponse } from "next/server";
import { AskRefused } from "@/lib/agents/ask";
import { MAX_SUBJECT_CHARS, runSpecDoc, type SpecDocAgent } from "@/lib/agents/specdoc";
import { getSessionUser } from "@/lib/auth/session";
import { readPrefs } from "@/lib/prefs";
import { isRunId, runStart, saveTurn } from "@/lib/runs";
import { SebtemberApiError } from "@/lib/sebtember/products";

export const runtime = "nodejs";
export const maxDuration = 120;

function isSpecDocAgent(value: unknown): value is SpecDocAgent {
  return value === "specification" || value === "quotation";
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const agent = body?.agent;
  if (!isSpecDocAgent(agent)) return NextResponse.json({ error: "invalid_agent" }, { status: 400 });
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (text.length === 0 || text.length > MAX_SUBJECT_CHARS) {
    return NextResponse.json({ error: "invalid_question" }, { status: 400 });
  }
  // Turned off on All agents: refused before any money is spent. A failed read refuses too.
  const prefs = await readPrefs(user.uid).catch(() => null);
  if (!prefs) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  if (prefs.disabledAgents.includes(agent)) {
    return NextResponse.json({ error: "agent_off" }, { status: 403 });
  }
  const runId = body?.runId == null ? null : String(body.runId);
  let subject = text;
  let refinement: string | null = null;
  // Checked before any money is spent: a stale, foreign or other-agent run is refused for free.
  if (runId !== null) {
    const start = isRunId(runId) ? await runStart(user.uid, runId) : null;
    if (!start || start.agent !== agent) {
      return NextResponse.json({ error: "run_not_found" }, { status: 404 });
    }
    if (start.first) {
      subject = start.first;
      refinement = text;
    }
  }
  try {
    const result = await runSpecDoc(user.uid, agent, subject, refinement);
    // The draft is paid for, so a failed save still returns it, without a run id.
    const savedRunId = await saveTurn(user.uid, runId, agent, text, result).catch((err) => {
      console.error(`[${agent}] save failed uid=${user.uid}`, err);
      return null;
    });
    return NextResponse.json({ ...result, runId: savedRunId });
  } catch (err) {
    if (err instanceof AskRefused) {
      return NextResponse.json({ error: err.code }, { status: 403 });
    }
    if (err instanceof SebtemberApiError) {
      console.error(`[${agent}] sebtember`, err.status, err.code);
      return NextResponse.json({ error: err.code }, { status: 502 });
    }
    console.error(`[${agent}]`, err);
    return NextResponse.json({ error: "answer_failed" }, { status: 502 });
  }
}
