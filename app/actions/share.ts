"use server";

import { headers } from "next/headers";
import { getSessionUser } from "@/lib/auth/session";
import { isRunId } from "@/lib/runs";
import { isShareToken, shareAnswer, shareTokenOf, stopSharing } from "@/lib/shares";

type Result = { ok: true; url: string | null; token: string | null } | { ok: false; error: string };

/** The page's own origin, from the request (dev.plugent.app on dev, localhost locally). */
async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function result(token: string | null): Promise<Result> {
  return { ok: true, token, url: token ? `${await origin()}/a/${token}` : null };
}

/** Is this answer shared? Its link, or nulls. Creates nothing. */
export async function shareStateAction(runId: string, answer: string): Promise<Result> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!isRunId(String(runId))) return { ok: false, error: "run_not_found" };
  try {
    return result(await shareTokenOf(user.uid, runId, String(answer ?? "")));
  } catch (err) {
    console.error("[share] state failed", err);
    return { ok: false, error: "unavailable" };
  }
}

/** Shares one stored answer of the user's run as a public page; the same answer keeps its link. */
export async function shareAnswerAction(runId: string, answer: string): Promise<Result> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!isRunId(String(runId))) return { ok: false, error: "run_not_found" };
  try {
    const token = await shareAnswer(user.uid, runId, String(answer ?? ""));
    if (!token) return { ok: false, error: "answer_not_found" };
    return result(token);
  } catch (err) {
    console.error("[share] create failed", err);
    return { ok: false, error: "unavailable" };
  }
}

/** Stops a share: the public page is deleted. */
export async function stopSharingAction(token: string): Promise<Result> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!isShareToken(String(token))) return { ok: false, error: "not_found" };
  try {
    const done = await stopSharing(user.uid, token);
    return done ? result(null) : { ok: false, error: "not_found" };
  } catch (err) {
    console.error("[share] stop failed", err);
    return { ok: false, error: "unavailable" };
  }
}
