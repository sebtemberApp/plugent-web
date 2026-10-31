"use server";

import { type AgentId, isAgentId } from "@/lib/agents/registry";
import { getSessionUser } from "@/lib/auth/session";
import { FEEDBACK_MAX_CHARS, saveFeedback } from "@/lib/feedback";
import { isRunId, readTurnForFeedback } from "@/lib/runs";

/**
 * Sends the signed-in user's feedback on one agent's answer to the platform admin. A saved
 * turn is quoted from the store, and its run names the agent; the client's copy is used only
 * for an answer that has no stored turn (one whose save failed).
 */
export async function sendFeedbackAction(input: {
  agent: AgentId;
  runId: string | null;
  turnId?: string | null;
  question: string;
  answer: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const text = String(input?.text ?? "").trim();
  if (!text || text.length > FEEDBACK_MAX_CHARS) return { ok: false, error: "invalid_text" };
  const runId = typeof input.runId === "string" && isRunId(input.runId) ? input.runId : null;
  const turnId = typeof input.turnId === "string" ? input.turnId : null;
  try {
    const stored = runId ? await readTurnForFeedback(user.uid, runId, turnId) : null;
    if (runId && !stored) return { ok: false, error: "run_not_found" };
    const agent = stored?.agent ?? (isAgentId(input.agent) ? input.agent : null);
    if (!agent) return { ok: false, error: "invalid_agent" };
    await saveFeedback(user, {
      agent,
      runId,
      question: stored?.question ?? String(input.question ?? ""),
      answer: stored?.answer ?? String(input.answer ?? ""),
      text,
    });
    return { ok: true };
  } catch (err) {
    console.error("[feedback]", err);
    return { ok: false, error: "save_failed" };
  }
}
