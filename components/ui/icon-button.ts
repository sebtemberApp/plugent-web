/**
 * The canonical ICON-BUTTON treatment (Step 687).
 *
 * THE app-wide pattern for a standalone icon action: muted glyph at rest, and on
 * hover the whole target fills with the brand blue (`bg-info`) and the glyph
 * turns white. Already the treatment on ~20 surfaces (sidebar rows, the agents
 * rail, catalogue actions, the answer-footer icons); this module makes it a
 * single importable string so new work matches by default instead of by memory.
 *
 * USE IT FOR: standalone icon actions — copy, info ("i"), settings, mic,
 * feedback, agents, add.
 *
 * AND FOR A LABELLED ACTION SITTING BESIDE THEM (Step 835). MOI's "Match"
 * button was a filled blue primary next to the ghost CSV / XLS actions on the
 * same card, and the two read as different systems. When an action shares a row
 * — or a card — with icon-button actions, it takes this treatment too: add
 * padding and a text size, keep everything else.
 *
 *   <button className={iconButtonClass("h-8 px-4 text-sm font-medium")}>Match</button>
 *
 * DON'T use it for:
 *   • DISMISS affordances — a modal's close "X", an inline "remove" on a list
 *     row. Those stay muted (`hover:bg-muted hover:text-foreground`) so the way
 *     out of a dialog never reads as the primary action.
 *   • Menu triggers (kebabs), which carry their own `aria-expanded` styling.
 *   • Anything using the shared <Button> component — it has its own variants.
 *
 * SIZE IS THE CALLER'S: pass `size-7` / `size-8` / `h-7 w-7` alongside, since
 * icon targets legitimately differ per surface.
 *
 *   <button className={iconButtonClass("size-8")} …>
 */
import { cn } from "@/lib/utils";

/** Shape + rest colour + the blue hover fill + focus ring. No size — see above. */
export const ICON_BUTTON_CLASS =
  "inline-flex shrink-0 items-center justify-center rounded-chip text-muted-foreground transition-colors " +
  "hover:bg-info hover:text-white " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Compose the canonical treatment with per-call extras (size, positioning). */
export function iconButtonClass(...extra: Parameters<typeof cn>): string {
  return cn(ICON_BUTTON_CLASS, ...extra);
}
