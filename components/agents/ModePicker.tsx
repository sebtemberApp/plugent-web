"use client";

import { Check, ChevronDown, Sparkles, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AskMode } from "@/lib/agents/ask";

const MODES: { id: AskMode; label: string; description: string }[] = [
  {
    id: "standard",
    label: "Standard",
    description: "Answers at the usual depth. Faster.",
  },
  {
    id: "deep",
    label: "Deeper thinking",
    description: "Reasons longer for harder questions. Slower and uses more tokens.",
  },
];

/** The composer's mode, as in Sebtember chat: Standard or Deeper thinking. The menu opens
 *  upwards from the composer; the choice stays until it is changed. */
export function ModePicker({
  mode,
  onChange,
  disabled,
}: {
  mode: AskMode;
  onChange: (mode: AskMode) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const deep = mode === "deep";
  return (
    <div ref={box} className="relative">
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-30 mb-2 w-72 rounded-control bg-raised p-1.5 shadow-pop"
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="menuitemradio"
              aria-checked={mode === m.id}
              onClick={() => {
                onChange(m.id);
                setOpen(false);
              }}
              className="flex w-full items-start gap-2.5 rounded-chip px-2.5 py-2 text-left hover:bg-fill1"
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-act">
                {mode === m.id && <Check aria-hidden size={16} strokeWidth={2.4} />}
              </span>
              <span className="flex flex-col">
                <span className="text-[15px] font-semibold">{m.label}</span>
                <span className="text-[13px] leading-[18px] text-ink2">{m.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Chat mode: ${deep ? "Deeper thinking" : "Standard"}. Change it.`}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold disabled:opacity-40 ${
          deep ? "bg-sel text-link" : "text-ink2 hover:bg-fill1 hover:text-ink"
        } ${open ? "bg-fill1" : ""}`}
      >
        {deep ? <Sparkles aria-hidden size={15} /> : <Zap aria-hidden size={15} />}
        {deep ? "Deeper thinking" : "Standard"}
        <ChevronDown aria-hidden size={14} />
      </button>
    </div>
  );
}
