"use client";

import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteRunAction, renameRunAction } from "@/app/actions/runs";
import { DeleteRunDialog } from "./DeleteRunDialog";

const TITLE_MAX = 80;

/**
 * The run header's "More" (the canvas's round 36px button on every agent board): rename and
 * delete, the same actions as the sidebar row's menu. Shown only once the run exists.
 */
export function RunMenu({
  runId,
  title,
  leaveTo,
  onRenamed,
}: {
  runId: string;
  title: string;
  /** The agent's own page, where a delete leaves to (the run's URL would be a 404). */
  leaveTo: string;
  onRenamed: (title: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const open = menu || renaming;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setMenu(false);
        setRenaming(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(false);
      setRenaming(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (renaming) input.current?.select();
  }, [renaming]);

  function saveName() {
    const next = draft.replace(/\s+/g, " ").trim();
    setRenaming(false);
    if (!next || next === title) return;
    start(async () => {
      const res = await renameRunAction(runId, next);
      if (!res.ok) return setError("Couldn't rename. Try again.");
      setError(null);
      onRenamed(res.title);
    });
  }

  function remove() {
    start(async () => {
      const res = await deleteRunAction(runId, leaveTo);
      if (!res.ok)
        setError(
          "error" in res && res.error === "busy"
            ? "It's still answering. Delete it when the answer is in."
            : "Couldn't delete. Try again.",
        );
      setConfirming(false);
    });
  }

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={menu}
        disabled={pending}
        onClick={() => {
          setRenaming(false);
          setMenu((m) => !m);
        }}
        className="flex size-9 items-center justify-center rounded-full bg-fill2 text-ink hover:bg-sel hover:text-link disabled:opacity-60"
      >
        <Ellipsis aria-hidden size={18} />
      </button>
      {menu && (
        <div
          role="menu"
          className="absolute top-full right-0 z-30 mt-1.5 w-44 rounded-control bg-raised p-1.5 shadow-pop"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              setDraft(title);
              setRenaming(true);
            }}
            className="flex h-9 w-full items-center gap-2.5 rounded-chip px-2.5 text-left text-[15px] hover:bg-fill1"
          >
            <Pencil aria-hidden size={16} className="text-ink2" />
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              setConfirming(true);
            }}
            className="flex h-9 w-full items-center gap-2.5 rounded-chip px-2.5 text-left text-[15px] text-danger hover:bg-fill1"
          >
            <Trash2 aria-hidden size={16} />
            Delete
          </button>
        </div>
      )}
      {renaming && (
        <div className="absolute top-full right-0 z-30 mt-1.5 w-72 rounded-control bg-raised p-2.5 shadow-pop">
          <input
            ref={input}
            value={draft}
            maxLength={TITLE_MAX}
            aria-label="Run name"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveName();
            }}
            className="h-10 w-full rounded-chip bg-fill1 px-3 text-[15px] outline-none ring-2 ring-act/35 focus-visible:outline-none"
          />
          <p className="px-1 pt-1.5 text-[12px] text-ink2">Enter to save, Esc to cancel</p>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="absolute top-full right-0 mt-1.5 text-[12px] whitespace-nowrap text-danger"
        >
          {error}
        </p>
      )}
      {confirming && (
        <DeleteRunDialog
          title={title}
          busy={pending}
          onCancel={() => setConfirming(false)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}
