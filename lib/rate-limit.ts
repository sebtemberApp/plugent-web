/**
 * Per-user rate limit in Plugent's Firestore, sebtember's `consumeRateLimit` (`lib/chat/rate-limit.ts`)
 * ported: `rate_limits/{uid}_{scope}_{minute}` → `{count, createdAt}`, read and bumped in one
 * transaction so a burst cannot double the cap. Server-only, like every Plugent collection.
 *
 * Every agent route checks it after its free checks and before any money is spent: the balance
 * gate runs once per request, and sebtember lets a wallet go into bounded debt, so without a cap
 * parallel runs could each start on the same last tokens.
 */
import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { plugentDb } from "@/lib/firebase/admin";

/** Sebtember's agent and chat cap: 20 runs a minute per user. */
export const AGENT_RUNS_PER_MINUTE = 20;

/** true when the call is allowed; the counter moves only then. */
export async function consumeRateLimit(
  uid: string,
  scope: string,
  maxPerWindow = AGENT_RUNS_PER_MINUTE,
  windowMs = 60_000,
): Promise<boolean> {
  const db = plugentDb();
  const ref = db
    .collection("rate_limits")
    .doc(`${uid}_${scope}_${Math.floor(Date.now() / windowMs)}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = Number(snap.get("count") ?? 0);
    if (current >= maxPerWindow) return false;
    if (snap.exists) tx.update(ref, { count: FieldValue.increment(1) });
    else tx.set(ref, { count: 1, createdAt: FieldValue.serverTimestamp() });
    return true;
  });
}
