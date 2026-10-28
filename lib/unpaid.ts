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
import { FieldValue } from "firebase-admin/firestore";
import { plugentDb } from "@/lib/firebase/admin";
import { type ChargeLine, type ChargeResult, charge } from "@/lib/sebtember/products";

/** After this many failed retries the line is left for the operator (`gaveUp`), not retried. */
const MAX_RETRIES = 20;

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
 * Retries kept lines: one user's (`uid`), or everyone's for the cron. A paid line is deleted; a
 * failed one counts its retries. Returns how many were paid and how many are still unpaid.
 */
export async function retryUnpaid(
  uid: string | null,
  limit = 50,
): Promise<{ paid: number; failed: number }> {
  let query = unpaid().where("gaveUp", "==", false);
  if (uid) query = unpaid().where("uid", "==", uid);
  const snap = await query.limit(limit).get();
  let paid = 0;
  let failed = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.gaveUp === true) continue;
    try {
      await charge(String(d.uid), String(d.source), [d.line as ChargeLine]);
      await doc.ref.delete();
      console.log(`[unpaid] paid line=${doc.id} uid=${d.uid} tokens=${d.line?.tokens}`);
      paid++;
    } catch (err) {
      const retries = Number(d.retries ?? 0) + 1;
      await doc.ref.update({
        retries,
        gaveUp: retries >= MAX_RETRIES,
        error: String((err as Error)?.message ?? err).slice(0, 300),
        retriedAt: FieldValue.serverTimestamp(),
      });
      failed++;
    }
  }
  return { paid, failed };
}
