/**
 * Feedback on an agent's answer: one icon on the answer card opens a short form, and each
 * note is one document in Plugent's Firestore `answer_feedback`, read by the platform admin
 * in the Firebase console for now. It carries the question and the answer it is about, so
 * the note still makes sense if the user later deletes the run.
 */
import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import type { AgentId } from "@/lib/agents/registry";
import { plugentDb } from "@/lib/firebase/admin";

export const FEEDBACK_MAX_CHARS = 2000;
const QUOTE_MAX_CHARS = 4000;

export async function saveFeedback(
  user: { uid: string; email: string | null },
  note: {
    agent: AgentId;
    runId: string | null;
    question: string;
    answer: string;
    text: string;
  },
): Promise<void> {
  await plugentDb()
    .collection("answer_feedback")
    .add({
      uid: user.uid,
      email: user.email,
      agent: note.agent,
      runId: note.runId,
      question: note.question.slice(0, QUOTE_MAX_CHARS),
      answer: note.answer.slice(0, QUOTE_MAX_CHARS),
      text: note.text,
      status: "new",
      createdAt: FieldValue.serverTimestamp(),
    });
}
