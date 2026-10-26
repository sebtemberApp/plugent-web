/**
 * Firebase Auth in the browser — pointed at SEBTEMBER's Firebase project, not Plugent's.
 *
 * ⚠️ ONE LOGIN FOR BOTH PRODUCTS (decided 2026-10-25, like PeakPick): a Plugent user IS a
 * Sebtember user, with the same uid, so sebtember's product API can find their wallet and
 * their catalogues. Plugent's own data (agents, runs, results) will live in Plugent's own
 * Firebase project, through the Admin SDK on the server, never through this app.
 *
 * Only import this from "use client" code.
 */
import { type FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth } from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_SEBTEMBER_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_SEBTEMBER_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_SEBTEMBER_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_SEBTEMBER_FIREBASE_APP_ID,
};

for (const [key, value] of Object.entries(config)) {
  if (!value)
    throw new Error(`Missing Sebtember Firebase env var for "${key}" (see .env.example).`);
}

const app: FirebaseApp = getApps().length === 0 ? initializeApp(config) : getApp();

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
