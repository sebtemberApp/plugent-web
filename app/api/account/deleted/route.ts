/**
 * POST /api/account/deleted — sebtember.app's account deletion tells Plugent to delete the
 * user's data (sebtember plan Part 1b). Body `{uid}`; answers `{ok, deleted}` with how many
 * top-level records went (`lib/account-delete.ts`). Idempotent.
 *
 * ⚠️ SERVER TO SERVER, the product API's check turned round: the caller sends a Google ID
 * token minted by sebtember's own service account for the audience
 * `SEBTEMBER_DELETE_AUDIENCE`; it must verify (signature, audience, issuer, expiry) and name a
 * verified email listed in `SEBTEMBER_CALLER_EMAILS`. Either variable unset → 503, nothing
 * deleted: the route is closed until both are configured. Never a session cookie.
 */
import { OAuth2Client } from "google-auth-library";
import { type NextRequest, NextResponse } from "next/server";
import { deleteUserData, isUid } from "@/lib/account-delete";

export const runtime = "nodejs";
export const maxDuration = 300;

const oauth = new OAuth2Client();

function callerEmails(): Set<string> {
  return new Set(
    (process.env.SEBTEMBER_CALLER_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function POST(req: NextRequest) {
  const audience = process.env.SEBTEMBER_DELETE_AUDIENCE?.trim();
  const allowed = callerEmails();
  if (!audience || allowed.size === 0) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  let email = "";
  try {
    const payload = (await oauth.verifyIdToken({ idToken, audience })).getPayload();
    if (payload?.email_verified === true && typeof payload.email === "string") {
      email = payload.email.toLowerCase();
    }
  } catch {
    // An invalid, expired or wrong-audience token: unauthorized below.
  }
  if (!email || !allowed.has(email)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { uid?: unknown } | null;
  if (!isUid(body?.uid)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const deleted = await deleteUserData(body.uid);
  console.log(`[account-deleted] uid=${body.uid} ${JSON.stringify(deleted)}`);
  return NextResponse.json({ ok: true, deleted });
}
