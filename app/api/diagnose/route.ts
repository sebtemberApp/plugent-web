/**
 * GET /api/diagnose — for the signed-in user only: the claims of the ID token Plugent sends
 * to sebtember.app (audience, service-account email; never the token itself) and sebtember's
 * raw answer to a balance read. Tells a Plugent-side mistake from a sebtember-side one.
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { diagnoseProductApi } from "@/lib/sebtember/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  try {
    return NextResponse.json(await diagnoseProductApi(user.uid));
  } catch (err) {
    return NextResponse.json({ error: String((err as Error)?.message ?? err) }, { status: 500 });
  }
}
