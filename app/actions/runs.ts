"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { deleteRun, isRunId, MAX_TITLE_CHARS, renameRun } from "@/lib/runs";

/** Renames one of the signed-in user's runs. */
export async function renameRunAction(
  runId: string,
  title: string,
): Promise<{ ok: true; title: string } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const clean = String(title ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!isRunId(String(runId))) return { ok: false, error: "run_not_found" };
  if (clean.length === 0 || clean.length > MAX_TITLE_CHARS) {
    return { ok: false, error: "invalid_title" };
  }
  const done = await renameRun(user.uid, runId, clean);
  if (!done) return { ok: false, error: "run_not_found" };
  // The sidebar lives in the shared layout: re-render it with the new name.
  revalidatePath("/", "layout");
  return { ok: true, title: clean };
}

/**
 * Deletes one of the signed-in user's runs and its answers, for good. `leaveTo` is where
 * to go when the deleted run is the page on screen (its URL would now be a 404).
 */
export async function deleteRunAction(
  runId: string,
  leaveTo: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!isRunId(String(runId))) return { ok: false, error: "run_not_found" };
  await deleteRun(user.uid, runId);
  revalidatePath("/", "layout");
  if (leaveTo && /^\/agents\/[a-z]+$/.test(leaveTo)) redirect(leaveTo);
  return { ok: true };
}
