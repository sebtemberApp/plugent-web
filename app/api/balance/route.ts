/**
 * GET /api/balance — the signed-in user's Sebtember wallet, read through sebtember's
 * product API. Milestone 1's proof that login and wallet are shared.
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getBalance, SebtemberApiError } from "@/lib/sebtember/products";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getBalance(user.uid));
  } catch (err) {
    if (err instanceof SebtemberApiError) {
      return NextResponse.json(
        { error: err.code },
        { status: err.status === 401 ? 502 : err.status },
      );
    }
    console.error("[balance]", err);
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
