/**
 * "Suggest an agent": users cannot add agents, they ask the platform admin for one. Each
 * suggestion is one document in Plugent's Firestore `agent_suggestions`, read by the admin
 * in the Firebase console for now.
 */
import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { plugentDb } from "@/lib/firebase/admin";

export const SUGGESTION_MIN_CHARS = 10;
export const SUGGESTION_MAX_CHARS = 2000;

export async function saveSuggestion(
  user: { uid: string; email: string | null },
  text: string,
): Promise<void> {
  await plugentDb().collection("agent_suggestions").add({
    uid: user.uid,
    email: user.email,
    text,
    status: "new",
    createdAt: FieldValue.serverTimestamp(),
  });
}
