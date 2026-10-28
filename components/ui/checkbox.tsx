"use client";

/**
 * Checkbox — shared Apple-style checkbox primitive (Step 94).
 *
 * Composed shape:
 *   - Native <input type="checkbox"> stays in the DOM (sr-only) so
 *     a11y, form integration, label-click activation, and
 *     keyboard-toggle semantics all work out of the box.
 *   - A sibling visual <span> renders the chrome: 20px square,
 *     6px radius, a border at 55% foreground when unchecked, and a
 *     bg-info fill when checked. A white check-glyph fades in via
 *     opacity (no layout shift, smooth transition).
 *
 * ⚠️ BOTH OF THOSE COLOURS CHANGED AT STEP 988, and both were measured
 * rather than picked. (The header also said "15% foreground" while the
 * code said /20 — it had been wrong about its own value.)
 *
 *   - The checked fill was `bg-primary`. `--primary` is `#16152e` in
 *     BOTH modes, so against the dark card (`#2b2d39` then — `#1c2027`
 *     since Step 1116, where every dark figure below only rises) it
 *     scored **1.30**:
 *     "checked" made the control RECEDE — a navy blob darker than its
 *     surroundings — where in light mode it advances as a bold square.
 *     `bg-info` scores 3.35 light / 4.07 dark, and is already the app's
 *     active colour (`iconButtonClass()` fills with it, and the Switch
 *     uses it for the same reason). The white glyph stays readable at
 *     3.35 against it — verified by rendering, not just arithmetic.
 *
 *   - The unchecked border was `foreground/20`, which scores **1.54
 *     light / 1.79 dark**. For an unchecked box the border is the ONLY
 *     signal — there is no glyph to carry it — so it has to clear the
 *     3:1 floor for a UI component. /50 is the minimum that clears both
 *     (3.41 / 4.10); /55 is used for margin (3.99 / 4.65) and because it
 *     is the alpha the Switch's OFF knob already uses, so the settings
 *     family has ONE value rather than two near-identical ones.
 *
 * Why the peer-sibling pattern (not absolute-overlay):
 *   `peer-checked:` only matches siblings AFTER the peer element
 *   in the same flow. Keeping the input as the first child + visual
 *   span as the second child gives Tailwind clean access to the
 *   checked state via `peer-checked:` for the bg, border, and
 *   the descendant glyph (`peer-checked:[&_svg]:opacity-100`).
 *
 * Click target:
 *   The native input is positioned as a transparent overlay
 *   covering the visual span (absolute inset-0 + opacity-0), so
 *   clicks anywhere on the 20×20 box hit the input directly and
 *   toggle it. This works whether or not the caller wraps the
 *   component in a <label> (UserList and TopUpCard do; SettingsView's
 *   VAT row didn't, which made the box "frozen" pre-Step 109).
 */

import { CheckIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Optional override of the base 20×20 size. Pass a Tailwind size
   *  utility like `h-6 w-6` to scale the box; the inner glyph scales
   *  proportionally via the embedded svg's relative units. */
  size?: "sm" | "md";
  /** Optional class on the visual span (NOT the input). Use to nudge
   *  alignment (e.g. `mt-0.5` when the checkbox sits next to multi-line
   *  text). */
  className?: string;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ size = "md", className, ...props }, ref) => {
    const dimensions = size === "sm" ? "h-[18px] w-[18px]" : "h-5 w-5";
    return (
      <span className={cn("relative inline-flex shrink-0", dimensions)}>
        <input
          ref={ref}
          type="checkbox"
          // Step 109: transparent overlay rather than sr-only. The
          // input fills the wrapper so clicks anywhere on the 20×20
          // visual area hit it directly — no <label> wrapper required.
          // peer ordering still works because the visual span comes
          // after this input as a sibling.
          className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          {...props}
        />
        <span
          aria-hidden="true"
          className={cn(
            "flex h-full w-full items-center justify-center rounded-md",
            "border border-foreground/55 bg-card",
            "shadow-[0_1px_1px_rgba(22,21,46,0.04)]",
            "transition-[background-color,border-color,box-shadow] duration-150",
            "peer-checked:bg-info peer-checked:border-info",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
            "peer-disabled:opacity-50 peer-disabled:cursor-not-allowed",
            "[&_svg]:opacity-0 peer-checked:[&_svg]:opacity-100",
            className,
          )}
        >
          <CheckIcon
            strokeWidth={3}
            aria-hidden="true"
            className="h-[70%] w-[70%] text-primary-foreground transition-opacity duration-150"
          />
        </span>
      </span>
    );
  },
);
Checkbox.displayName = "Checkbox";
