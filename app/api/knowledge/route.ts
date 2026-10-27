/**
 * GET /api/knowledge — the signed-in user's Sebtember catalogues, with file counts, the
 * Library flag and whether each is paused (`lib/knowledge.ts`).
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { readKnowledge } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const data = await readKnowledge(user.uid);
  return NextResponse.json(data, { status: "error" in data ? 502 : 200 });
}
