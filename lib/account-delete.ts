/**
 * Deleting a Sebtember account deletes the user's Plugent data (sebtember plan Part 1b).
 *
 * A Plugent user IS a Sebtember user (one login), so the account lives on sebtember.app and
 * its deletion cascade calls `/api/account/deleted` here, server to server. This removes
 * everything Plugent keeps for that uid, in Plugent's own Firestore:
 *
 *   - `users/{uid}` and every subcollection (runs + turns + photos, deleted_runs, shares
 *     pointers, ask_pending, ask_stops, preferences), with `recursiveDelete`;
 *   - the PUBLIC shared answers they made (`shared_answers` where `owner_uid` is them): a
 *     snapshot lives outside `users/{uid}` and would outlive the account otherwise;
 *   - their agent suggestions and answer feedback (they carry the email and quoted text);
 *   - their unpaid charge lines (the wallet they would be paid from is gone);
 *   - their rate-limit counters (`rate_limits/{uid}_…`).
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
}

async function deleteMatching(query: FirebaseFirestore.Query): Promise<number> {
  const snap = await query.get();
  const writer = plugentDb().bulkWriter();
  for (const doc of snap.docs) void writer.delete(doc.ref);
  await writer.close();
  return snap.size;
}

export async function deleteUserData(uid: string): Promise<DeletedCounts> {
  if (!isUid(uid)) throw new Error("invalid uid");
  const db = plugentDb();
  // The public face first: a share must not outlive its owner even if a later delete fails.
  const shared_answers = await deleteMatching(
    db.collection("shared_answers").where("owner_uid", "==", uid),
  );
  const [agent_suggestions, answer_feedback, unpaid_charges, rate_limits] = await Promise.all([
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
  ]);
  await db.recursiveDelete(db.collection("users").doc(uid));
  return { shared_answers, agent_suggestions, answer_feedback, unpaid_charges, rate_limits };
}
