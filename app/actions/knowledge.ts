"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { SebtemberApiError, setCataloguePaused } from "@/lib/sebtember/products";

const CATALOGUE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Pauses or resumes one of the signed-in user's catalogues: every agent skips a paused one. */
export async function setCataloguePausedAction(
  catalogueId: string,
  paused: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!CATALOGUE_ID.test(String(catalogueId))) return { ok: false, error: "not_found" };
  try {
    await setCataloguePaused(user.uid, catalogueId, paused === true);
  } catch (err) {
    if (!(err instanceof SebtemberApiError)) console.error("[knowledge pause]", err);
    return { ok: false, error: err instanceof SebtemberApiError ? err.code : "unavailable" };
  }
  revalidatePath("/knowledge");
  return { ok: true };
}
