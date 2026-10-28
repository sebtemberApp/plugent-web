/**
 * How long is left, in words — Step 1098.
 *
 * ⚠️ EXTRACTED RATHER THAN COPIED, and the reason is that this is user-facing
 * COPY rather than a calculation. Step 146's `ExtractProgressView` (catalogue
 * file extraction) and PRICING's `GatherProgressView` both tell a user how long
 * a read has left, in the same product, often minutes apart — and two spellings
 * of "~2m left" is the kind of drift nobody notices until both are wrong in
 * different ways. Six lines is a poor reason to keep two of them.
 *
 * Client-safe and pure: no imports, no `Date.now()`. The CALLER owns the clock,
 * because both callers tick locally (progress snapshots land tens of seconds
 * apart, so a server-computed remainder would visibly freeze).
 */

/**
 * ⚠️ "almost done" AT OR BELOW ZERO, never "~0s left". The estimate is a
 * projection from a fraction, so it overshoots routinely on the last segment —
 * and a countdown that reaches zero and keeps going reads as a stuck run, which
 * is the exact impression this whole display exists to prevent.
 */
export function formatEta(seconds: number): string {
  if (seconds <= 0) return "almost done";
  if (seconds < 60) return `~${seconds}s left`;
  const minutes = Math.round(seconds / 60);
  return `~${minutes}m left`;
}

/**
 * Seconds remaining, from elapsed time and the fraction done — or null when
 * there is not yet enough to say.
 *
 * ⚠️ NULL IS A REAL ANSWER and the caller must render it as "no estimate", not
 * as zero. Before the first segment lands there is no rate to extrapolate from,
 * and a bar that opens on "~0s left" and then climbs is worse than one that
 * says nothing for a moment.
 *
 * ⚠️ THE 1000 ms FLOOR is not caution about division — `fraction > 0` already
 * covers that. It is that a fraction measured over a few hundred milliseconds
 * extrapolates to nonsense, so the first estimate would be wild and then
 * correct itself in front of the user.
 */
export function etaSeconds(elapsedMs: number, fraction: number): number | null {
  if (fraction <= 0 || elapsedMs <= 1000) return null;
  const totalEstMs = elapsedMs / fraction;
  return Math.max(0, Math.round((totalEstMs - elapsedMs) / 1000));
}
