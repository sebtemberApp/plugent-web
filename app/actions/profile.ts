"use server";

import { getSessionUser } from "@/lib/auth/session";
import {
  getProfile,
  PERSONA_MAX_CHARS,
  type ProductProfile,
  SebtemberApiError,
  updateProfile,
} from "@/lib/sebtember/products";

/** What the account menu shows: the user's Sebtember reply language and persona brief. */
export interface ProfileView {
  /** A language code, "" when unset (agents answer in the language of the question). */
  language: string;
  persona: string;
  languages: { code: string; name: string }[];
}

type Result = { ok: true; profile: ProfileView } | { ok: false; error: string };

function view(p: ProductProfile): ProfileView {
  return { language: p.preferred_language, persona: p.persona_md, languages: p.languages };
}

function failure(err: unknown): { ok: false; error: string } {
  console.error("[profile]", err);
  return { ok: false, error: err instanceof SebtemberApiError ? err.code : "unavailable" };
}

/** Reads the signed-in user's profile from Sebtember. */
export async function readProfileAction(): Promise<Result> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  try {
    return { ok: true, profile: view(await getProfile(user.uid)) };
  } catch (err) {
    return failure(err);
  }
}

/** Saves the reply language; "" clears it. Sebtember refuses a code its picker does not offer. */
export async function saveLanguageAction(code: string): Promise<Result> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const clean = String(code ?? "").trim();
  if (clean !== "" && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(clean)) {
    return { ok: false, error: "unknown_language" };
  }
  try {
    return {
      ok: true,
      profile: view(await updateProfile(user.uid, { preferred_language: clean })),
    };
  } catch (err) {
    return failure(err);
  }
}

/** Saves the persona brief every agent answers with; "" clears it. Too long is refused, not cut. */
export async function savePersonaAction(text: string): Promise<Result> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const clean = String(text ?? "").trim();
  if (clean.length > PERSONA_MAX_CHARS) return { ok: false, error: "too_long" };
  try {
    return { ok: true, profile: view(await updateProfile(user.uid, { persona_md: clean })) };
  } catch (err) {
    return failure(err);
  }
}
