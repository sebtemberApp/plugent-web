"use client";

/**
 * The PRICING stage strip (Step 1095) — `1. Extract · 2. Match · 3. Price`.
 *
 * ## ⚠️ IT IS A STEPPER WEARING A TAB STRIP, AND THE DIFFERENCE IS THE DESIGN
 *
 * The operator drew a segmented control at the top of the page, which is the
 * right SHAPE — but tabs mean "peer views you may switch between freely", and
 * these three are neither peers nor free: Match does not exist until Extract
 * has read a file, and Price does not exist until Match has run. So the
 * affordance is the drawn one and the SEMANTICS are a stepper:
 *
 *   - a step you have not reached is genuinely `disabled`, not merely muted,
 *     and says why on hover — a segment that looks live and does nothing is
 *     worse than one that looks unavailable;
 *   - going BACK is free and changes nothing on the server;
 *   - going FORWARD is the button on the panel, never this strip, because
 *     forward costs tokens and a navigation control must not spend money.
 *
 * ⚠️ THE CLASSES ARE `ConnectView`'s TabTrigger, verbatim. That is this app's
 * segmented control (`/developer`), and the fourth surface to copy a class
 * string rather than the first to invent one — the same trade `SpecDocView`
 * (Step 939) and this page's own answer card (Step 1089) already took. The
 * cost of a copy is drift, so it is stated: if that strip changes, change this.
 *
 * ⚠️ AND IT RENDERS FROM `draft`, before anything is uploaded. The Step-943/944
 * blank-state rule says an empty page carries the control and no intro copy —
 * this is navigation rather than copy, and the alternative is chrome that
 * appears from nowhere the instant the upload lands. A first-time user seeing
 * three numbered stages before they choose a file is the point of a stepper.
 */
import { Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

export type PricingStep = 1 | 2 | 3;

/**
 * ⚠️ THE LABELS ARE THE STAGES, NOT THE STATUSES. `extracting` and
 * `awaiting_confirmation` are both "Extract" — reading the file and checking
 * what was read are one stage to the person doing it, and splitting them would
 * make the strip twitch mid-run.
 */
export const PRICING_STEPS: ReadonlyArray<{ step: PricingStep; label: string }> = [
  { step: 1, label: "Extract" },
  { step: 2, label: "Match" },
  { step: 3, label: "Price" },
];

/**
 * Why a step cannot be opened yet — shown on hover, because "disabled with no
 * explanation" is the version of this control that reads as broken.
 */
const LOCKED_REASON: Record<PricingStep, string> = {
  1: "",
  2: "Confirm the extracted lines first — Next runs the match.",
  3: "Finish the match first — the price list is priced from it.",
};

export function PricingSteps({
  current,
  reached,
  running,
  onSelect,
}: {
  /** The panel on screen. */
  current: PricingStep;
  /**
   * The furthest stage this run has UNLOCKED — a property of the document, not
   * of where the user is looking. Step 2 unlocks once the run has ever been
   * matched (`matching_started_at`), so going back to Extract never re-locks
   * the result the user already paid for.
   */
  reached: PricingStep;
  /** Stage 2 is in flight. Shown as a spinner IN the strip, so a user reading
   *  the Extract step can still see that their run is going. */
  running: boolean;
  onSelect: (step: PricingStep) => void;
}) {
  return (
    // ⚠️ A CENTRING WRAPPER, because `mx-auto` does nothing to an `inline-flex`
    // box — the strip would sit left while the header's title is centred above
    // it. The pill itself stays inline-flex so it hugs its three segments.
    // ⚠️ NO BOTTOM RULE (operator's call). The header above already carries one,
    // and a second hairline two rows down boxed the strip in against the card
    // below it — three horizontal lines in the top 140px of the page. The strip
    // reads as a control on its own without one.
    <div className="flex justify-center px-4 py-3">
      <div
        role="tablist"
        aria-label="Pricing stages"
        className="inline-flex max-w-full overflow-x-auto rounded-lg border border-hairline bg-muted/60 p-1"
      >
        {PRICING_STEPS.map(({ step, label }) => {
          const active = step === current;
          // ⚠️ The CURRENT step is never disabled, whatever `reached` says. The
          // two can disagree for one render while a snapshot lands, and a
          // control that disables the panel you are looking at reads as a bug.
          const locked = step > reached && !active;
          return (
            <button
              key={step}
              type="button"
              role="tab"
              aria-selected={active}
              aria-disabled={locked}
              disabled={locked}
              title={locked ? LOCKED_REASON[step] : undefined}
              onClick={() => onSelect(step)}
              className={cn(
                "inline-flex flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 py-1.5 text-body font-medium",
                "transition-[background-color,color,box-shadow] duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                active
                  ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/[0.06]"
                  : locked
                    ? "cursor-not-allowed text-muted-foreground/50"
                    : "text-muted-foreground hover:text-foreground",
              )}
            >
              {running && step === 2 ? (
                <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <span aria-hidden="true" className="tabular-nums">
                  {step}.
                </span>
              )}
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
