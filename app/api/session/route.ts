/**
 * POST /api/session — `{idToken}` from Sebtember's Firebase Auth → Plugent's session cookie.
 * DELETE /api/session — sign out.
 */
import { type NextRequest, NextResponse } from "next/server";
import {
  mintSession,
  SESSION_COOKIE,
  SESSION_DAYS,
  verifySebtemberIdToken,
} from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const idToken = typeof body?.idToken === "string" ? body.idToken : "";
  const user = idToken ? await verifySebtemberIdToken(idToken) : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = NextResponse.json({ uid: user.uid });
  res.cookies.set(SESSION_COOKIE, mintSession(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
