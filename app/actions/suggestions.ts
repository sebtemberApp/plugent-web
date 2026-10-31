"use server";

import { getSessionUser } from "@/lib/auth/session";
import { SUGGESTION_MAX_CHARS, SUGGESTION_MIN_CHARS, saveSuggestion } from "@/lib/suggestions";

/** Sends the signed-in user's agent suggestion to the platform admin. */
export async function suggestAgentAction(
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const clean = String(text ?? "").trim();
  if (clean.length < SUGGESTION_MIN_CHARS || clean.length > SUGGESTION_MAX_CHARS) {
    return { ok: false, error: "invalid_text" };
  }
  try {
    await saveSuggestion(user, clean);
    return { ok: true };
  } catch (err) {
    console.error("[suggest]", err);
    return { ok: false, error: "save_failed" };
  }
}
