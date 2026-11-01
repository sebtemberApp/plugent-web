/**
 * Charges that failed, kept for a retry (audit B3). A run's model work is charged to sebtember
 * once it is done; if both attempts fail the answer is still shown, so the line must not be lost:
 * it is written to `unpaid_charges/{lineId}` with the wallet the balance call returned, and paid
 * later by `retryUnpaid` (the user's next run, and the daily cron `/api/cron/unpaid-charges`).
 *
 * ⚠️ THE LINE ID IS THE KEY ON BOTH SIDES. Sebtember charges a line id once, so a retry of a line
 * that did reach it is a duplicate, never a second charge; the wallet is the stored one, never
 * re-resolved. Server-only, like every Plugent collection.
 */
import "server-only";
import { type DocumentReference, FieldValue, type WriteBatch } from "firebase-admin/firestore";
import { plugentDb } from "@/lib/firebase/admin";
import { type ChargeLine, type ChargeResult, charge } from "@/lib/sebtember/products";
import type { TurnCharge } from "@/lib/usage";

/**
 * A line is left for the operator (`gaveUp`) only after this many failed retries AND this much
 * time: counted alone, 20 runs in a short sebtember outage (the user's next runs each retry their
 * lines) gave a line up within minutes, and nothing retried it again.
 */
const MAX_RETRIES = 20;
const GIVE_UP_AFTER_MS = 14 * 86_400_000;

/** A failed line waits 2^retries minutes (a day at most) before its next retry. */
const backoffMs = (retries: number) => Math.min(2 ** retries, 1440) * 60_000;

const millisOf = (t: unknown) =>
  t && typeof (t as { toMillis?: () => number }).toMillis === "function"
    ? (t as { toMillis: () => number }).toMillis()
    : 0;

function unpaid() {
  return plugentDb().collection("unpaid_charges");
}

/**
 * Charges one line: two attempts, then the line is kept for a retry. null when it was not
 * charged now (the caller shows the answer as not charged).
 */
export async function chargeOrKeep(
  agent: string,
  uid: string,
  source: string,
  line: ChargeLine,
): Promise<ChargeResult | null> {
  const once = () => charge(uid, source, [line]);
  try {
    return await once().catch(once);
  } catch (err) {
    console.error(`[${agent}] charge failed uid=${uid} line=${line.id} tokens=${line.tokens}`, err);
    await unpaid()
      .doc(line.id)
      .set({
        uid,
        source,
        agent,
        line,
        retries: 0,
        gaveUp: false,
        error: String((err as Error)?.message ?? err).slice(0, 300),
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch((e) => console.error(`[${agent}] UNPAID LINE NOT KEPT line=${line.id}`, e));
    return null;
  }
}

/**
 * Links kept lines to the turn they belong to, in the batch that saves the turn: paying a line
 * later then adds it to the turn's `charges` and marks the turn charged (audit N7).
 */
export function linkUnpaid(
  batch: WriteBatch,
  lines: TurnCharge[] | undefined,
  turn: DocumentReference,
): void {
  for (const c of lines ?? []) {
    batch.set(unpaid().doc(c.line), { turnPath: turn.path, charge: c }, { merge: true });
  }
}

/**
 * Retries kept lines: one user's (`uid`), or everyone's for the cron. A paid line is deleted; a
 * failed one counts its retries. Returns how many were paid and how many are still unpaid.
 */
export async function retryUnpaid(
  uid: string | null,
  limit = 50,
): Promise<{ paid: number; failed: number }> {
  // One equality filter each, so no composite index: a user's lines are filtered for `gaveUp`
  // here, over a page large enough that given-up lines cannot crowd out live ones (audit N8).
  const snap = uid
    ? await unpaid().where("uid", "==", uid).limit(200).get()
    : // A wider page than `limit`, so lines still backing off do not crowd out the due ones.
      await unpaid()
        .where("gaveUp", "==", false)
        .limit(Math.max(limit * 4, 500))
        .get();
  let paid = 0;
  let failed = 0;
  const now = Date.now();
  const live = snap.docs
    .filter((doc) => doc.get("gaveUp") === false && doc.get("line"))
    .filter((doc) => {
      const last = millisOf(doc.get("retriedAt"));
      return !last || now - last >= backoffMs(Number(doc.get("retries") ?? 0));
    })
    .slice(0, limit);
  for (const doc of live) {
    const d = doc.data();
    try {
      await charge(String(d.uid), String(d.source), [d.line as ChargeLine]);
      // The turn it belongs to now shows it paid, and the Usage page counts it.
      if (typeof d.turnPath === "string" && d.charge) {
        await plugentDb()
          .doc(d.turnPath)
          .update({ charges: FieldValue.arrayUnion(d.charge), charged: true })
          .catch((err) => console.warn(`[unpaid] turn not updated line=${doc.id}`, err?.message));
      } else if (typeof d.deletedRunPath === "string" && d.charge) {
        // Its run was deleted while the line was unpaid: the deleted run's record keeps it.
        await plugentDb()
          .doc(d.deletedRunPath)
          .set(
            { spent: FieldValue.arrayUnion({ at: Date.now(), charges: [d.charge] }) },
            { merge: true },
          )
          .catch((err) =>
            console.warn(`[unpaid] deleted run not updated line=${doc.id}`, err?.message),
          );
      }
      await doc.ref.delete();
      console.log(`[unpaid] paid line=${doc.id} uid=${d.uid} tokens=${d.line?.tokens}`);
      paid++;
    } catch (err) {
      const retries = Number(d.retries ?? 0) + 1;
      const age = now - (millisOf(d.createdAt) || now);
      // A concurrent retry (the cron and a user's run) may have paid and deleted it meanwhile:
      // that is not a failure of this loop, and the remaining lines still get their turn.
      await doc.ref
        .update({
          retries,
          gaveUp: retries >= MAX_RETRIES && age >= GIVE_UP_AFTER_MS,
          error: String((err as Error)?.message ?? err).slice(0, 300),
          retriedAt: FieldValue.serverTimestamp(),
        })
        .catch((e) => console.warn(`[unpaid] retry not recorded line=${doc.id}`, e?.message));
      failed++;
    }
  }
  return { paid, failed };
}
