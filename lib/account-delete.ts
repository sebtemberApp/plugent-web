/**
 * Deleting a Sebtember account deletes the user's Plugent data (sebtember plan Part 1b).
 *
 * A Plugent user IS a Sebtember user (one login), so the account lives on sebtember.app and
 * its deletion cascade calls `/api/account/deleted` here, server to server. This removes
 * everything Plugent keeps for that uid, in Plugent's own Firestore:
 *
 *   - `users/{uid}` and every subcollection (runs + turns + traces + photos, deleted_runs, shares
 *     pointers, ask_pending, ask_stops, preferences), with `recursiveDelete`;
 *   - the PUBLIC shared answers they made (`shared_answers` where `owner_uid` is them): a
 *     snapshot lives outside `users/{uid}` and would outlive the account otherwise;
 *   - their agent suggestions and answer feedback (they carry the email and quoted text);
 *   - their unpaid charge lines (the wallet they would be paid from is gone);
 *   - their rate-limit counters (`rate_limits/{uid}_…`);
 *   - their conversations' results in the Chat review (`chat_reviews` where `uids` holds them):
 *     the review quotes passages and answers, so it is redacted, not left to its 30-day TTL.
 *
 * ⚠️ A delete that fails THROWS, so sebtember's cascade sees a failure and retries; it is never
 * counted as done.
 *
 * Idempotent: a user Plugent never saw, or one already deleted, removes nothing and is not an
 * error. Pricing uploads live on sebtember (`product-uploads/{uid}/`) and go with its own sweep.
 */
import "server-only";
import { FieldPath } from "firebase-admin/firestore";
import { plugentDb } from "@/lib/firebase/admin";

/** A Sebtember uid: what Firebase Auth issues (never "/" or "."), as sebtember checks it. */
const UID = /^[A-Za-z0-9_-]{1,128}$/;

export function isUid(value: unknown): value is string {
  return typeof value === "string" && UID.test(value);
}

export interface DeletedCounts {
  shared_answers: number;
  agent_suggestions: number;
  answer_feedback: number;
  unpaid_charges: number;
  rate_limits: number;
  chat_reviews: number;
}

async function deleteMatching(query: FirebaseFirestore.Query): Promise<number> {
  const snap = await query.get();
  const writer = plugentDb().bulkWriter();
  const writes = snap.docs.map((doc) => writer.delete(doc.ref));
  await writer.close();
  // `close()` resolves even when writes failed (after BulkWriter's retries): read each one.
  const failed = (await Promise.allSettled(writes)).filter((r) => r.status === "rejected");
  if (failed.length > 0) throw new Error(`${failed.length} of ${snap.size} deletes failed`);
  return snap.size;
}

/** Removes the user's results from every Chat review that judged one of their conversations. */
async function redactReviews(uid: string): Promise<number> {
  const db = plugentDb();
  const snap = await db.collection("chat_reviews").where("uids", "array-contains", uid).get();
  await Promise.all(
    snap.docs.map((doc) =>
      db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        const results = (fresh.get("results") ?? []) as { uid?: string }[];
        const uids = (fresh.get("uids") ?? []) as string[];
        tx.update(doc.ref, {
          results: results.filter((r) => r.uid !== uid),
          uids: uids.filter((u) => u !== uid),
        });
      }),
    ),
  );
  return snap.size;
}

export async function deleteUserData(uid: string): Promise<DeletedCounts> {
  if (!isUid(uid)) throw new Error("invalid uid");
  const db = plugentDb();
  // The public face first: a share must not outlive its owner even if a later delete fails.
  const shared_answers = await deleteMatching(
    db.collection("shared_answers").where("owner_uid", "==", uid),
  );
  const [agent_suggestions, answer_feedback, unpaid_charges, rate_limits, chat_reviews] =
    await Promise.all([
      deleteMatching(db.collection("agent_suggestions").where("uid", "==", uid)),
      deleteMatching(db.collection("answer_feedback").where("uid", "==", uid)),
      deleteMatching(db.collection("unpaid_charges").where("uid", "==", uid)),
      // `{uid}_{scope}_{minute}`: every id that starts with "{uid}_".
      deleteMatching(
        db
          .collection("rate_limits")
          .where(FieldPath.documentId(), ">=", `${uid}_`)
          .where(FieldPath.documentId(), "<", `${uid}_\uf8ff`),
      ),
      redactReviews(uid),
    ]);
  await db.recursiveDelete(db.collection("users").doc(uid));
  return {
    shared_answers,
    agent_suggestions,
    answer_feedback,
    unpaid_charges,
    rate_limits,
    chat_reviews,
  };
}
