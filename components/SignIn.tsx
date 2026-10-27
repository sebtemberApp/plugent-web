"use client";

import { FirebaseError } from "firebase/app";
import {
  getRedirectResult,
  onIdTokenChanged,
  signInWithPopup,
  signInWithRedirect,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { auth, googleProvider } from "@/lib/firebase/client";

/**
 * Sign in with the SEBTEMBER account. A Firebase user that is already signed in (an
 * expired Plugent cookie, or a sign-in on sebtember.app in this browser) is exchanged for
 * a session at once, so the page goes straight on to Home.
 */
export function SignIn() {
  const router = useRouter();
  // "checking" until Firebase says whether a user is already signed in.
  const [phase, setPhase] = useState<"checking" | "idle" | "busy" | "entering">("checking");
  // The failure, shown on the page: a silent failure cannot be diagnosed.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Consumes the return trip of the redirect fallback below.
    getRedirectResult(auth).catch((err) => setError(describe(err)));
    return onIdTokenChanged(auth, async (user) => {
      if (!user) return setPhase("idle");
      setPhase("entering");
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken: await user.getIdToken() }),
      }).catch(() => null);
      if (!res?.ok) {
        const body = (await res?.json().catch(() => ({}))) ?? {};
        const reason = body.error ?? `session_refused_${res?.status ?? "offline"}`;
        setError(body.detail ? `${reason}: ${body.detail}` : reason);
        return setPhase("idle");
      }
      router.replace("/home");
      router.refresh();
    });
  }, [router]);

  async function signIn() {
    setPhase("busy");
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      // A blocked popup falls back to a full-page redirect, as sebtember.app does.
      if (err instanceof FirebaseError && err.code === "auth/popup-blocked") {
        await signInWithRedirect(auth, googleProvider).catch((e) => setError(describe(e)));
        return;
      }
      if (!(err instanceof FirebaseError && err.code === "auth/popup-closed-by-user")) {
        setError(describe(err));
      }
      setPhase("idle");
    }
  }

  const waiting = phase !== "idle";
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={signIn}
        disabled={waiting}
        className="h-[52px] rounded-full bg-act px-6 text-[17px] font-bold text-white hover:bg-act-press disabled:opacity-60"
      >
        {phase === "entering"
          ? "Opening Plugent…"
          : phase === "busy"
            ? "Signing in…"
            : phase === "checking"
              ? "Checking your account…"
              : "Sign in with your Sebtember account"}
      </button>
      {error && (
        <p role="alert" className="text-[15px] text-danger">
          Sign-in failed: {error}
        </p>
      )}
    </div>
  );
}

function describe(err: unknown): string {
  if (err instanceof FirebaseError) return err.code;
  return err instanceof Error ? err.message : String(err);
}
