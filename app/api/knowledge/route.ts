/**
 * GET /api/knowledge — the signed-in user's Sebtember catalogues that Plugent may read,
 * with file counts and the Library flag, plus the link that changes the choice
 * (`lib/knowledge.ts`).
 */
import { type NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { readKnowledge } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const data = await readKnowledge(user.uid, new URL("/knowledge", req.nextUrl.origin).toString());
  return NextResponse.json(data, { status: "error" in data ? 502 : 200 });
}
