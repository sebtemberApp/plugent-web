/**
 * Plugent's OWN Firestore (project `plugent-dev`; a prod project later), through the Admin
 * SDK on the server only. The credential is the same `PLUGENT_SERVICE_ACCOUNT_JSON` that
 * proves Plugent to sebtember; its `project_id` names the project, and it needs the
 * `roles/datastore.user` role there (granted on plugent-dev 2026-10-27).
 *
 * ⚠️ CLIENTS NEVER READ OR WRITE THIS DATABASE — `firestore.rules` denies everything, so
 * every read goes through a route or a server action that takes the uid from the session.
 * Set `FIRESTORE_EMULATOR_HOST` to run against the emulator; no credential is needed then.
 */
import "server-only";
import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";

/**
 * ⚠️ ONE INSTANCE PER PROCESS, kept on `globalThis`: each route's bundle carries its own copy of
 * this module, but `getFirestore()` hands every copy the SAME instance, and a second `settings()`
 * on it throws ("Firestore has already been initialized") — the second route to touch Firestore
 * in a warm process failed.
 */
const shared = globalThis as typeof globalThis & { __plugentDb?: Firestore };

export function plugentDb(): Firestore {
  if (shared.__plugentDb) return shared.__plugentDb;
  if (getApps().length === 0) {
    const emulator = process.env.FIRESTORE_EMULATOR_HOST;
    const key = process.env.PLUGENT_SERVICE_ACCOUNT_JSON?.trim();
    if (emulator) {
      initializeApp({ projectId: process.env.PLUGENT_FIREBASE_PROJECT_ID ?? "plugent-dev" });
    } else {
      if (!key) throw new Error("PLUGENT_SERVICE_ACCOUNT_JSON is not set.");
      const credentials = JSON.parse(key);
      initializeApp({ credential: cert(credentials), projectId: credentials.project_id });
    }
  }
  const db = getFirestore(getApp());
  db.settings({ ignoreUndefinedProperties: true });
  shared.__plugentDb = db;
  return db;
}
