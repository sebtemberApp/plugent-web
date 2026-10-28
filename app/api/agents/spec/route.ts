/**
 * POST /api/agents/spec — the Specification and Quotation agents (`lib/agents/specdoc.ts`).
 * Body `{agent: "specification" | "quotation", text, runId?}`; the user is the session's,
 * never the body's. A new run's text is its SUBJECT; in an existing run it is a refinement
 * of the subject the run started with, which is read from the stored run, never the body, and
 * the run's earlier refinements still apply (audit B12).
 */
import { after, type NextRequest, NextResponse } from "next/server";
import { AskRefused } from "@/lib/agents/ask";
import { MAX_SUBJECT_CHARS, runSpecDoc, type SpecDocAgent } from "@/lib/agents/specdoc";
import { getSessionUser } from "@/lib/auth/session";
import { readPrefs } from "@/lib/prefs";
import { consumeRateLimit } from "@/lib/rate-limit";
import { claimRun, isRunId, readRun, releaseRun, saveTurn } from "@/lib/runs";
import { SebtemberApiError } from "@/lib/sebtember/products";
import { retryUnpaid } from "@/lib/unpaid";

export const runtime = "nodejs";
// Far above the draft's own timeout (100 s), so the charge and the save always get to run.
export const maxDuration = 300;

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
  // Checked before any money is spent: a stale, foreign or other-agent run is refused for free,
  // and the run is claimed, so a second refinement waits for the first.
  if (runId !== null) {
    const claim = isRunId(runId) ? await claimRun(user.uid, runId, agent) : null;
    if (claim === null) return NextResponse.json({ error: "run_not_found" }, { status: 404 });
    if (claim === "busy") return NextResponse.json({ error: "busy" }, { status: 409 });
  }
  if (!(await consumeRateLimit(user.uid, "agents"))) {
    if (runId) await releaseRun(user.uid, runId);
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  after(() => retryUnpaid(user.uid, 5).catch((err) => console.error("[unpaid] retry", err)));
  try {
    // The subject is the run's first request; every later one is a refinement, and they add up.
    const asked = runId
      ? ((await readRun(user.uid, runId))?.turns ?? []).map((t) => t.question)
      : [];
    const [subject = text, ...earlier] = asked;
    const refinements = asked.length > 0 ? [...earlier, text] : [];
    const result = await runSpecDoc(user.uid, agent, subject, refinements);
    // The draft is paid for, so a failed save still returns it, without a run id.
    const saved = await saveTurn(user.uid, runId, agent, text, result).catch(async (err) => {
      console.error(`[${agent}] save failed uid=${user.uid}`, err);
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
      console.error(`[${agent}] sebtember`, err.status, err.code);
      if (err.status === 429) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
      return NextResponse.json({ error: err.code }, { status: 502 });
    }
    console.error(`[${agent}]`, err);
    return NextResponse.json({ error: "answer_failed" }, { status: 502 });
  }
}
