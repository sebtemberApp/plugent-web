"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { deleteRun, isRunId, MAX_TITLE_CHARS, readPricingRun, renameRun } from "@/lib/runs";
import { cancelPricing, deletePricing } from "@/lib/sebtember/pricing";
import { SebtemberApiError } from "@/lib/sebtember/products";
import { stopRunShares } from "@/lib/shares";

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
  // A Pricing run's document (and the tender file) lives in sebtember: delete it there first. If
  // that fails the row stays, so the user is never told the file is gone while it is not.
  const pricing = await readPricingRun(user.uid, runId);
  if (pricing) {
    // Sebtember refuses to delete a running step (409 busy): stop it first, then delete.
    const remove = () => deletePricing(user.uid, pricing.pricingId);
    const removed = await remove()
      .catch(async (err) => {
        if (err instanceof SebtemberApiError && err.status === 404) return; // already gone there
        if (!(err instanceof SebtemberApiError && err.code === "busy")) throw err;
        await cancelPricing(user.uid, pricing.pricingId, true);
        await remove();
      })
      .then(
        () => true,
        (err) => {
          console.error(`[runs] sebtember pricing delete failed run=${runId}`, err);
          return false;
        },
      );
    if (!removed) return { ok: false, error: "delete_failed" };
  }
  // Its shared answers go first: a public page must not outlive the run it came from.
  await stopRunShares(user.uid, runId);
  await deleteRun(user.uid, runId);
  revalidatePath("/", "layout");
  if (leaveTo && /^\/agents\/[a-z]+$/.test(leaveTo)) redirect(leaveTo);
  return { ok: true };
}
