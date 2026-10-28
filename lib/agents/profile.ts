/**
 * What every agent reads about the user from Sebtember before it answers: the reply language
 * and the user's own notes (`/api/products/profile`, sebtember Step 1183). Sebtember's agents
 * read the same two fields from `users/{uid}`.
 *
 * ⚠️ FAIL-OPEN: a profile Sebtember cannot return means no language (the model answers in the
 * language the user wrote in) and no notes. An agent never refuses over it.
 */
import "server-only";
import { getProfile } from "@/lib/sebtember/products";

export interface UserContext {
  /** The user's Sebtember language as an English name ("Lithuanian"); null when unset. */
  languageName: string | null;
  /** The user's own notes about themselves (Sebtember's `persona_md`). */
  personaMd: string;
}

/** Sebtember's `resolveResponseLanguage`: a language code to its English name; null when
 *  unset or unknown. (The profile route already reads a retired language as unset.) */
export function languageName(code: string | null | undefined): string | null {
  const raw = (code ?? "").trim().toLowerCase();
  if (!raw) return null;
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "language", fallback: "none" }).of(raw.slice(0, 2)) ??
      null
    );
  } catch {
    return null;
  }
}

export async function readUserContext(uid: string): Promise<UserContext> {
  const profile = await getProfile(uid).catch((err) => {
    console.warn(`[profile] read failed uid=${uid}`, err);
    return null;
  });
  return {
    languageName: languageName(profile?.preferred_language),
    personaMd: profile?.persona_md ?? "",
  };
}
