"use client";

/**
 * What the read is doing — Step 1098.
 *
 * Replaces the PRICING extract step's single "Reading your file…" line, which
 * said the same thing at second 3 and second 170 of a 47-page tender. The
 * operator's report was the honest version of the complaint: *"user is waiting
 * for a result without a clue how long this will take"*.
 *
 * ## ⚠️ A PHASE AND A COUNT, because a count alone is silent when it matters
 *
 * A PDF is split, rasterised and probed for its KIND before the first
 * extraction call, and the gather's own budget is anchored above all of that
 * precisely because those "can take real time on a large file" (audit F5). So a
 * count-only display sits at "0 of 47" through exactly the stretch a user is
 * most likely to read as a hang — and then again at "47 of 47" through the
 * assembly pass, which makes its own model calls.
 *
 * ## ⚠️ IT IS NOT A LIST OF ITEMS, and that was a deliberate decline
 *
 * Streaming the extracted rows as they arrive is the obvious version and it
 * would LIE. The batch loop returns raw per-segment items; everything that
 * makes them the list the user checks happens after it — continuation joining,
 * spec-ref enrichment, merging, summarising (`gather.ts` logs `merged`,
 * `enriched`, `summarised`, `continuationsJoined`, `refCollisions`). A row
 * streamed at page 3 would appear, be renamed, then merge into another row and
 * vanish. On the one screen whose whole job is line-by-line checking, a list
 * that rewrites itself under the reader is worse than a spinner.
 *
 * ⚠️ THE BAR AND THE ETA ARE STEP 146's, deliberately. `ExtractProgressView`
 * shows a catalogue file extracting, in the same product, with the same
 * question behind it — so this wears the same 1px bar, the same right-aligned
 * countdown and (since Step 1098) the same `formatEta` wording, rather than a
 * second dialect of "how long left". The COMPONENTS stay apart because the
 * phases and units are different; the vocabulary does not.
 */

import { useEffect, useState } from "react";
import type { GatherProgress } from "@/lib/pricing/confirm";
import { etaSeconds, formatEta } from "@/lib/ui/eta";

export function GatherProgressView({
  progress,
  startedAtMs,
}: {
  progress: GatherProgress;
  /**
   * When THIS read started — `gather_started_at`, not the document's
   * `createdAt`.
   *
   * ⚠️ A draft row waits an unbounded time for its upload (that is what a draft
   * IS), so a `createdAt` anchor would measure the wait rather than the read and
   * report a countdown of hours. Null on a run written before the field, which
   * simply shows no estimate.
   */
  startedAtMs: number | null;
}) {
  // A local 1s clock, so the estimate counts down smoothly between snapshots.
  // Progress lands at most once a second and often far less on a slow page, so
  // a value that only moved with Firestore would visibly freeze.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const counted = progress.phase === "scanning" && progress.total > 0;
  const pct = counted ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;

  let eta: string | null = null;
  if (counted && progress.done > 0 && startedAtMs !== null) {
    const remainingS = etaSeconds(nowMs - startedAtMs, progress.done / progress.total);
    if (remainingS !== null) eta = formatEta(remainingS);
  }

  /**
   * ⚠️ THE COUNT NAMES THE PAGE BEING READ, not the number finished — `done + 1`,
   * clamped. "Reading page 12 of 47" after 12 are done is what a person means by
   * it, and "12 of 47 read" would show 0 for the whole of the first page.
   */
  const headline =
    progress.phase === "preparing"
      ? "Opening your file…"
      : progress.phase === "assembling"
        ? "Putting the list together…"
        : counted
          ? `Reading ${progress.unit} ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`
          : "Reading your file…";

  return (
    <div className="flex flex-col gap-2 rounded-card border border-hairline bg-card px-4 py-3 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <span className="text-subhead text-foreground">{headline}</span>
        {eta !== null ? (
          <span className="shrink-0 text-footnote text-muted-foreground tabular-nums">{eta}</span>
        ) : null}
      </div>

      {/* ⚠️ THE BAR ONLY EXISTS WHERE THERE IS SOMETHING TO MEASURE. The two
          uncounted phases render the line alone rather than an empty or
          indeterminate track — a bar stuck at 0% is the exact impression this
          replaces. */}
      {pct !== null ? (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-info transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}

      {/* ⚠️ SAYS WHAT IT IS DOING, not what it has found. The gather's items are
          not final until assembly, so a running count of "items so far" would
          land on a number that then changes — the same reason the rows
          themselves are not streamed. */}
      <span className="text-footnote text-muted-foreground">
        {progress.phase === "assembling"
          ? "Merging split rows and filling in specifications."
          : "Each page is read on its own, so a long document takes a few minutes."}
      </span>
    </div>
  );
}
