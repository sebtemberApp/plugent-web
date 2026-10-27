"use client";

import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteRunAction, renameRunAction } from "@/app/actions/runs";
import type { RunSummary } from "@/lib/runs";
import { DeleteRunDialog } from "./DeleteRunDialog";

const TITLE_MAX = 80;

/** An agent's runs under its sidebar row: open, rename in place, delete with a confirm. */
export function RunList({
  runs,
  hrefFor,
  onNavigate,
}: {
  runs: RunSummary[];
  hrefFor: (id: string) => string;
  onNavigate?: () => void;
}) {
  if (runs.length === 0) return null;
  return (
    <ul className="mb-1 ml-[22px] flex flex-col border-hair border-l-[0.5px] pl-2">
      {runs.map((run) => (
        <RunRow key={run.id} run={run} href={hrefFor(run.id)} onNavigate={onNavigate} />
      ))}
    </ul>
  );
}

function RunRow({
  run,
  href,
  onNavigate,
}: {
  run: RunSummary;
  href: string;
  onNavigate?: () => void;
}) {
  const path = usePathname();
  const active = path === href;
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [title, setTitle] = useState(run.title);
  const [draft, setDraft] = useState(run.title);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLLIElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setTitle(run.title), [run.title]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useEffect(() => {
    if (renaming) input.current?.select();
  }, [renaming]);

  function saveName() {
    const next = draft.replace(/\s+/g, " ").trim();
    setRenaming(false);
    if (!next || next === title) return setDraft(title);
    const before = title;
    setTitle(next);
    start(async () => {
      const res = await renameRunAction(run.id, next);
      if (!res.ok) {
        setTitle(before);
        setDraft(before);
        setError("Couldn't rename. Try again.");
        return;
      }
      setError(null);
    });
  }

  function remove() {
    start(async () => {
      // The action refreshes the sidebar, or leaves the deleted run's page for a new one.
      const res = await deleteRunAction(run.id, active ? href.replace(/\/[^/]+$/, "") : null);
      if (!res.ok) setError("Couldn't delete. Try again.");
      setConfirming(false);
    });
  }

  if (renaming) {
    return (
      <li className="py-0.5">
        <input
          ref={input}
          value={draft}
          maxLength={TITLE_MAX}
          aria-label="Run name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveName();
            if (e.key === "Escape") {
              setDraft(title);
              setRenaming(false);
            }
          }}
          onBlur={saveName}
          className="h-9 w-full rounded-chip bg-raised px-2.5 text-[14px] shadow-card outline-none ring-2 ring-act/35 focus-visible:outline-none"
        />
        <p className="px-1 pt-1 text-[12px] text-ink2">Enter to save, Esc to cancel</p>
      </li>
    );
  }

  return (
    <li ref={box} className="group relative">
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`flex h-9 items-center rounded-chip pr-9 pl-2.5 text-[14px] ${
          active ? "bg-sel font-semibold text-ink" : "text-ink2 hover:bg-fill1 hover:text-ink"
        } ${pending ? "opacity-60" : ""}`}
      >
        <span className="truncate">{title}</span>
      </Link>
      <button
        type="button"
        aria-label={`More for ${title}`}
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((m) => !m)}
        className={`absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-ink2 hover:bg-fill2 hover:text-ink ${
          menu || active ? "opacity-100" : "opacity-100 min-[900px]:opacity-0"
        } group-hover:opacity-100 focus-visible:opacity-100`}
      >
        <Ellipsis aria-hidden size={16} />
      </button>
      {menu && (
        <div
          role="menu"
          className="absolute top-full right-0 z-20 mt-1 w-44 rounded-control bg-raised p-1.5 shadow-pop"
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
      {error && (
        <p role="alert" className="px-2.5 pb-1 text-[12px] text-danger">
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
    </li>
  );
}
