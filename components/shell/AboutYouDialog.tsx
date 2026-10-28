"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { savePersonaAction } from "@/app/actions/profile";

/** Mirrors `PERSONA_MAX_CHARS` (`lib/sebtember/products.ts`, server-only). */
const MAX = 8000;

/** Sebtember's own example brief (its Chat settings dialog), so both products ask the same. */
const PLACEHOLDER = [
  "## My role",
  "Senior HVAC technician — 15 years, mostly commercial chillers.",
  "",
  "## Tools I use daily",
  "- Testo 550i manifold",
  "- Fluke 1587 insulation tester",
  "",
  "## Decision style",
  "Prefer concrete part numbers + measured values over high-level overviews.",
  "",
  "## Avoid",
  "- Marketing-speak about products",
].join("\n");

/**
 * "About you" — the user's own brief on themselves (Sebtember's `persona_md`), which every
 * agent answers with. It is the same field Sebtember's Chat settings edit, saved through
 * `/api/products/profile/update`, so a change shows on both sites.
 */
export function AboutYouDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: string;
  onClose: () => void;
  onSaved: (persona: string) => void;
}) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const area = useRef<HTMLTextAreaElement>(null);
  const changed = text.trim() !== initial.trim();

  useEffect(() => {
    area.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !pending && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  function save() {
    setError(null);
    start(async () => {
      const res = await savePersonaAction(text);
      if (res.ok) {
        onSaved(res.profile.persona);
        onClose();
      } else {
        setError(
          res.error === "too_long"
            ? `Keep it under ${MAX.toLocaleString("en-US")} characters.`
            : "It couldn't be saved. Try again.",
        );
      }
    });
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={() => !pending && onClose()}
        className="absolute inset-0 bg-[rgba(22,21,46,0.35)]"
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-you-title"
        aria-describedby="about-you-body"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="relative flex max-h-[calc(100dvh-32px)] w-full max-w-[560px] flex-col gap-3 rounded-list bg-raised p-6 shadow-pop"
      >
        <div className="flex items-start gap-3">
          <h2 id="about-you-title" className="flex-1 text-[20px] leading-[26px] font-semibold">
            About you
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => !pending && onClose()}
            className="-mt-1 -mr-2 flex size-9 items-center justify-center rounded-full text-ink2 hover:bg-fill1"
          >
            <X aria-hidden size={18} />
          </button>
        </div>
        <p id="about-you-body" className="text-[15px] leading-[22px] text-ink2">
          Every agent follows this. Tell them your role, the tools you use, how you like answers
          framed and what to avoid. It is shared with sebtember.app and takes effect on your next
          question.
        </p>
        <textarea
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          maxLength={MAX}
          disabled={pending}
          rows={12}
          aria-label="About you"
          className="min-h-[220px] flex-1 resize-y rounded-control bg-fill1 p-3.5 text-[15px] leading-[22px] outline-none placeholder:text-ink2 focus-visible:ring-2 focus-visible:ring-act/35 focus-visible:outline-none disabled:opacity-60"
        />
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {error ? (
            <p role="alert" className="flex-1 text-[14px] text-danger">
              {error}
            </p>
          ) : (
            <span className="flex-1 text-[13px] text-ink2 tabular-nums">
              {text.length.toLocaleString("en-US")} / {MAX.toLocaleString("en-US")}
            </span>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="h-11 rounded-full bg-fill2 px-5 text-[15px] font-semibold disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || !changed}
            className="h-11 rounded-full bg-act px-6 text-[15px] font-bold text-white hover:bg-act-press disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
