/**
 * The Chat composer's Stop (audit F5): `users/{uid}/ask_stops/{stopId}`. The streaming answer
 * listens to its own document; `/api/agents/ask/stop` creates it. Under the user's own path, so
 * a stop id can only ever stop the user's own answer. The answer deletes it when it ends.
 */
import "server-only";
import { plugentDb } from "@/lib/firebase/admin";

export function isStopId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function askStopRef(uid: string, stopId: string) {
  return plugentDb().collection("users").doc(uid).collection("ask_stops").doc(stopId);
}

/**
 * An answer in flight (audit N1): `users/{uid}/ask_pending/{turnId}`, written when the answer
 * starts and deleted when its turn is saved; a failure leaves its error code here. A reader
 * whose connection dropped asks `/api/agents/ask/turn`, which reads the turn, then this.
 */
export function askPendingRef(uid: string, turnId: string) {
  return plugentDb().collection("users").doc(uid).collection("ask_pending").doc(turnId);
}
