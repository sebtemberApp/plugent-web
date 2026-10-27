/**
 * POST /api/agents/troubleshoot — the Troubleshooting agent (`lib/agents/troubleshoot.ts`).
 * Body `{runId?, text?, photo?: {mediaType, data}, thumb?, outcome?: {stepId, kind}}`: a
 * described problem or an answer (text and/or a photo), or the outcome of the current step.
 * The user is the session's, never the body's; the run and its state are read from the store.
 */
import { type NextRequest, NextResponse } from "next/server";
import { AskRefused } from "@/lib/agents/ask";
import { respondTroubleshooting, TS_LIMITS, TsRefused } from "@/lib/agents/troubleshoot";
import type { StepOutcomeKind } from "@/lib/agents/troubleshoot-prompts";
import { getSessionUser } from "@/lib/auth/session";
import { readPrefs } from "@/lib/prefs";
import { isRunId } from "@/lib/runs";
import { SebtemberApiError } from "@/lib/sebtember/products";

export const runtime = "nodejs";
export const maxDuration = 120;

const OUTCOMES: readonly StepOutcomeKind[] = ["done", "nothing", "skip", "fixed"];
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return bad("unauthorized", 401);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return bad("invalid_request");

  const runId = body.runId == null ? null : String(body.runId);
  if (runId !== null && !isRunId(runId)) return bad("run_not_found", 404);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length > TS_LIMITS.MAX_TEXT_CHARS) return bad("invalid_question");

  let photo: { mediaType: string; data: string } | null = null;
  if (body.photo != null) {
    const { mediaType, data } = body.photo as { mediaType?: unknown; data?: unknown };
    if (
      typeof mediaType !== "string" ||
      !PHOTO_TYPES.includes(mediaType) ||
      typeof data !== "string" ||
      data.length === 0 ||
      data.length > TS_LIMITS.MAX_PHOTO_CHARS ||
      !/^[A-Za-z0-9+/=]+$/.test(data)
    ) {
      return bad("invalid_photo");
    }
    photo = { mediaType, data };
  }
  const thumb =
    photo &&
    typeof body.thumb === "string" &&
    body.thumb.length <= TS_LIMITS.MAX_THUMB_CHARS &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.thumb)
      ? body.thumb
      : null;

  let outcome: { stepId: string; kind: StepOutcomeKind } | null = null;
  if (body.outcome != null) {
    const { stepId, kind } = body.outcome as { stepId?: unknown; kind?: unknown };
    if (typeof stepId !== "string" || !OUTCOMES.includes(kind as StepOutcomeKind)) {
      return bad("invalid_outcome");
    }
    if (runId === null) return bad("run_not_found", 404);
    outcome = { stepId, kind: kind as StepOutcomeKind };
  } else if (!text && !photo) {
    return bad("invalid_question");
  }

  // Turned off on All agents: refused before any money is spent. A failed read refuses too.
  const prefs = await readPrefs(user.uid).catch(() => null);
  if (!prefs) return bad("unavailable", 503);
  if (prefs.disabledAgents.includes("troubleshooting")) return bad("agent_off", 403);

  try {
    const result = await respondTroubleshooting(user.uid, {
      runId,
      text: outcome ? "" : text,
      photo: outcome ? null : photo,
      thumb: outcome ? null : thumb,
      outcome,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof TsRefused) {
      return bad(err.code, err.code === "run_not_found" ? 404 : 409);
    }
    if (err instanceof AskRefused) return bad(err.code, 403);
    if (err instanceof SebtemberApiError) {
      console.error("[troubleshooting] sebtember", err.status, err.code);
      return bad(err.code, 502);
    }
    console.error("[troubleshooting]", err);
    return bad("answer_failed", 502);
  }
}
