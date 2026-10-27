"use server";

import { getSessionUser } from "@/lib/auth/session";
import { FEEDBACK_MAX_CHARS, saveFeedback } from "@/lib/feedback";
import { isRunId } from "@/lib/runs";

/** Sends the signed-in user's feedback on one Chat answer to the platform admin. */
export async function sendFeedbackAction(input: {
  runId: string | null;
  question: string;
  answer: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const text = String(input?.text ?? "").trim();
  if (!text || text.length > FEEDBACK_MAX_CHARS) return { ok: false, error: "invalid_text" };
  const runId = typeof input.runId === "string" && isRunId(input.runId) ? input.runId : null;
  try {
    await saveFeedback(user, {
      agent: "chat",
      runId,
      question: String(input.question ?? ""),
      answer: String(input.answer ?? ""),
      text,
    });
    return { ok: true };
  } catch (err) {
    console.error("[feedback]", err);
    return { ok: false, error: "save_failed" };
  }
}
