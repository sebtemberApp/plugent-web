/**
 * POST /api/agents/ask/stop — the Chat composer's Stop (audit F5). Body `{stopId}`, the id the
 * answer's stream started with; the user is the session's. The streaming answer sees the
 * document, stops its model and ends with what it wrote. Stopping an answer that has already
 * ended changes nothing (the answer deletes its document when it ends; this one is left inert).
 */
import { FieldValue } from "firebase-admin/firestore";
import { type NextRequest, NextResponse } from "next/server";
import { askStopRef, isStopId } from "@/lib/ask-stop";
import { getSessionUser } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const stopId = typeof body?.stopId === "string" ? body.stopId : "";
  if (!isStopId(stopId)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  await askStopRef(user.uid, stopId).set({ at: FieldValue.serverTimestamp() });
  return NextResponse.json({ ok: true });
}
