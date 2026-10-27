"use client";

import { Pause, Play } from "lucide-react";
import { useState, useTransition } from "react";
import { setCataloguePausedAction } from "@/app/actions/knowledge";

const ERRORS: Record<string, string> = {
  not_found: "This catalogue is no longer available to you. Reload the page.",
  unauthorized: "Your session has ended. Reload the page to sign in again.",
};

/** Pause or resume one catalogue. A paused catalogue is skipped by every agent. */
export function PauseButton({
  catalogueId,
  name,
  paused,
}: {
  catalogueId: string;
  name: string;
  paused: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    start(async () => {
      const result = await setCataloguePausedAction(catalogueId, !paused).catch(() => null);
      if (!result?.ok) {
        const code = result && !result.ok ? result.error : "unavailable";
        setError(ERRORS[code] ?? "Couldn't save. Try again in a moment.");
      }
    });
  }

  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={paused}
        aria-label={paused ? `Resume ${name}` : `Pause ${name}`}
        className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold disabled:opacity-50 ${
          paused
            ? "bg-sel text-link hover:bg-fill2"
            : "bg-fill1 text-ink2 hover:bg-fill2 hover:text-ink"
        }`}
      >
        {paused ? (
          <Play aria-hidden size={13} strokeWidth={2.2} />
        ) : (
          <Pause aria-hidden size={13} strokeWidth={2.2} />
        )}
        {pending ? "Saving…" : paused ? "Resume" : "Pause"}
      </button>
      {error && (
        <span role="alert" className="max-w-[220px] text-right text-[12px] text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
