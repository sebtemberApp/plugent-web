"use server";

import { getSessionUser } from "@/lib/auth/session";
import { isAgentId } from "@/lib/prefs";
import { listOlderRuns, type OlderRuns } from "@/lib/run-history";

/** The sidebar's "Show more": one agent's runs from `beforeMs` back. */
export async function olderRunsAction(
  agent: string,
  beforeMs: number,
): Promise<({ ok: true } & OlderRuns) | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const id = String(agent);
  if (!isAgentId(id)) return { ok: false, error: "unknown_agent" };
  const before = Number(beforeMs);
  if (!Number.isFinite(before) || before <= 0) return { ok: false, error: "invalid_cursor" };
  try {
    return { ok: true, ...(await listOlderRuns(user.uid, id, before)) };
  } catch (err) {
    console.error(`[runs] older runs failed agent=${agent}`, err);
    return { ok: false, error: "unavailable" };
  }
}
