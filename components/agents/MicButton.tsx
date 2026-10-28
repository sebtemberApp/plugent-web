"use client";

import { Loader2, Mic, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useBalance } from "@/components/shell/BalanceContext";
import { useAudioRecorder } from "./useAudioRecorder";

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const ERRORS: Record<string, string> = {
  low_balance: "Your balance is too low to transcribe. Top up on Sebtember.",
  rate_limited: "You're going fast. Try again in a minute.",
  audio_too_long: "That recording is too long. Keep it under 5 minutes.",
  unsupported_audio: "This browser records in a format that can't be read. Try another browser.",
};

/**
 * Speak: the composer's microphone (audit F2). Tap to record, tap the square to stop; the clip
 * is transcribed by `/api/transcribe` (charged to the wallet) and the text lands in the composer
 * for the user to read and send. The recording shows its clock and can be cancelled for free.
 * A browser without a microphone API shows nothing.
 */
export function MicButton({
  onText,
  disabled = false,
}: {
  onText: (text: string) => void;
  disabled?: boolean;
}) {
  const { spent } = useBalance();
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mic = useAudioRecorder(async (blob, mimeType) => {
    setTranscribing(true);
    setError(null);
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "content-type": mimeType },
        body: blob,
      });
      const data = await res.json().catch(() => ({ error: `http_${res.status}` }));
      if (!res.ok) {
        setError(ERRORS[String(data.error)] ?? "Couldn't transcribe that. Try again.");
        return;
      }
      if (typeof data.balanceAfter === "number") spent(data.balanceAfter);
      const text = String(data.text ?? "").trim();
      if (text) onText(text);
      else setError("No speech was heard. Try again a little closer to the microphone.");
    } catch {
      setError("Couldn't transcribe that. Check your connection and try again.");
    } finally {
      setTranscribing(false);
    }
  });

  const message = error ?? mic.error;
  // A message clears itself after a few seconds (and on the next recording).
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  if (!mic.supported) return null;

  return (
    <span className="relative flex items-center gap-1">
      {message && (
        <span
          role="alert"
          className="absolute right-0 bottom-full mb-2 w-max max-w-[min(320px,80vw)] rounded-control bg-raised px-3 py-2 text-[13px] leading-[18px] text-danger shadow-pop"
        >
          {message}
        </span>
      )}
      {mic.recording ? (
        <>
          <button
            type="button"
            aria-label="Cancel recording"
            title="Cancel"
            onClick={mic.cancel}
            className="flex size-9 items-center justify-center rounded-full text-ink2 hover:bg-fill1 hover:text-ink"
          >
            <X aria-hidden size={18} />
          </button>
          <button
            type="button"
            aria-label={`Stop recording, ${clock(mic.seconds)}`}
            onClick={mic.stop}
            className="flex h-9 items-center gap-2 rounded-full bg-sel pr-3.5 pl-3 text-[14px] font-semibold text-link tabular-nums"
          >
            <span aria-hidden className="size-2 animate-pulse rounded-full bg-act" />
            {clock(mic.seconds)}
            <Square aria-hidden size={13} fill="currentColor" strokeWidth={0} />
          </button>
        </>
      ) : (
        <button
          type="button"
          aria-label={transcribing ? "Transcribing" : "Speak"}
          title={transcribing ? "Transcribing…" : "Speak"}
          disabled={disabled || transcribing}
          onClick={() => {
            setError(null);
            void mic.start();
          }}
          className="flex size-9 items-center justify-center rounded-full text-ink2 hover:bg-fill1 hover:text-ink disabled:opacity-50 disabled:hover:bg-transparent"
        >
          {transcribing ? (
            <Loader2 aria-hidden size={18} className="animate-spin" />
          ) : (
            <Mic aria-hidden size={18} />
          )}
        </button>
      )}
    </span>
  );
}
