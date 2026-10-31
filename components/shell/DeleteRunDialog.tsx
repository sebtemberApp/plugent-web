"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/** "Delete this run?" — the canvas's confirm, over the whole page. */
export function DeleteRunDialog({
  title,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={() => !busy && onCancel()}
        className="absolute inset-0 bg-[rgba(22,21,46,0.35)]"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-run-title"
        aria-describedby="delete-run-body"
        className="relative flex w-full max-w-[440px] flex-col gap-2.5 rounded-list bg-raised p-6 shadow-pop"
      >
        <h2 id="delete-run-title" className="text-[20px] leading-[26px] font-semibold">
          Delete this run?
        </h2>
        <p id="delete-run-body" className="text-[15px] leading-[22px] text-ink2">
          “{title}” and its answers are deleted for good. Tokens it used are not refunded.
        </p>
        <div className="flex justify-end gap-2.5 pt-2.5">
          <button
            ref={cancel}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-11 rounded-full bg-fill2 px-5 text-[15px] font-semibold disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="h-11 rounded-full bg-[#D70015] px-5 text-[15px] font-bold text-white disabled:opacity-60"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
