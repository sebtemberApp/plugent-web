"use client";

import { RotateCcw } from "lucide-react";
import { useBalance } from "@/components/shell/BalanceContext";

/** What every agent says for the codes its routes share; an agent's own `messages` win. */
const COMMON: Record<string, string> = {
  low_balance: "Your Sebtember balance is too low for this.",
  not_connected: "Plugent can't read your Sebtember catalogues just now. Try again in a moment.",
  unauthorized: "Your session has ended. Reload the page to sign in again.",
  rate_limited: "You're going fast. Try again in a minute.",
  busy: "The previous answer is still being worked out. Wait a moment and try again.",
  answer_failed: "The answer couldn't be written this time. Try again.",
  unavailable: "Sebtember isn't answering just now. Try again in a moment.",
  unreachable: "Plugent couldn't be reached. Check your connection and try again.",
};

/** Codes a second try cannot change: no Retry is offered for them. */
const FINAL = new Set([
  "low_balance",
  "agent_off",
  "invalid_question",
  "invalid_photo",
  "invalid_agent",
  "unauthorized",
  "run_not_found",
  "finished",
  "not_current_step",
]);

/**
 * A failed turn: a sentence for the code (never the raw code alone), a link to top up when the
 * wallet is short, and a Retry pill when trying again can help (audit B7, B8).
 */
export function AgentError({
  code,
  messages = {},
  onRetry,
}: {
  code: string;
  messages?: Record<string, string>;
  onRetry?: () => void;
}) {
  const { topUpUrl } = useBalance();
  const text =
    messages[code] ?? COMMON[code] ?? `Something went wrong (${code}). Try again in a moment.`;
  const retry = onRetry && !FINAL.has(code);
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-card px-6 py-5 shadow-card"
    >
      <p className="min-w-0 flex-1 text-[15px] text-danger">
        {text}
        {code === "low_balance" && topUpUrl && (
          <>
            {" "}
            <a href={topUpUrl} className="text-link font-semibold">
              Top up on Sebtember
            </a>
          </>
        )}
      </p>
      {retry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-fill2 px-4 text-[15px] font-semibold text-ink hover:bg-sel hover:text-link"
        >
          <RotateCcw aria-hidden size={16} />
          Retry
        </button>
      )}
    </div>
  );
}
