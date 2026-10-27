"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { isAgentId, setAgentEnabled, setChatMode } from "@/lib/prefs";

/** Turns one agent on or off for the signed-in user. Off hides it everywhere and refuses its runs. */
export async function setAgentEnabledAction(
  agent: string,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!isAgentId(agent)) return { ok: false, error: "unknown_agent" };
  await setAgentEnabled(user.uid, agent, enabled === true);
  // The sidebar lives in the shared layout.
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Chat's default mode for a new chat: Standard or Deeper thinking. */
export async function setChatModeAction(
  mode: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (mode !== "standard" && mode !== "deep") return { ok: false, error: "invalid_mode" };
  await setChatMode(user.uid, mode);
  revalidatePath("/", "layout");
  return { ok: true };
}
