"use client";

import { Check, Copy, Globe, Share2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { shareAnswerAction, shareStateAction, stopSharingAction } from "@/app/actions/share";

const ICON_BUTTON =
  "flex size-9 items-center justify-center rounded-chip text-ink2 hover:bg-fill1 hover:text-ink";

type State =
  | { kind: "reading" }
  | { kind: "unshared" }
  | { kind: "shared"; url: string; token: string };

/**
 * The answer footer's Share: a public, read-only page for this one answer (`lib/shares.ts`).
 * As Sebtember's share dialog: nothing is published until "Create public link", the dialog
 * says who can see it, and a shared answer shows its link with Copy and Stop sharing.
 */
export function ShareButton({ runId, answer }: { runId: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const [shared, setShared] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={shared ? "Shared publicly: manage the link" : "Share this answer"}
        title={shared ? "Shared publicly: manage the link" : "Share this answer"}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={`${ICON_BUTTON} ${shared ? "text-link hover:text-link" : ""}`}
      >
        <Share2 aria-hidden size={18} />
      </button>
      {open && (
        <ShareDialog
          runId={runId}
          answer={answer}
          onShared={setShared}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ShareDialog({
  runId,
  answer,
  onShared,
  onClose,
}: {
  runId: string;
  answer: string;
  onShared: (shared: boolean) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "reading" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
    let live = true;
    shareStateAction(runId, answer).then(
      (res) => {
        if (!live) return;
        if (!res.ok) return setError("The share couldn't be read. Close and try again.");
        onShared(Boolean(res.token));
        setState(
          res.token && res.url
            ? { kind: "shared", url: res.url, token: res.token }
            : { kind: "unshared" },
        );
      },
      () => live && setError("The share couldn't be read. Close and try again."),
    );
    return () => {
      live = false;
    };
  }, [runId, answer, onShared]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy. Select the link and copy it.");
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    const res = await shareAnswerAction(runId, answer).catch(() => null);
    setBusy(false);
    if (!res?.ok || !res.url || !res.token) {
      return setError(
        res && !res.ok && res.error === "answer_not_found"
          ? "This answer isn't saved yet. Reload the page and try again."
          : "The link couldn't be created. Try again.",
      );
    }
    onShared(true);
    setState({ kind: "shared", url: res.url, token: res.token });
    void copy(res.url);
  }

  async function stop(token: string) {
    setBusy(true);
    setError(null);
    const res = await stopSharingAction(token).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError("Sharing couldn't be stopped. Try again.");
    onShared(false);
    setState({ kind: "unshared" });
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={() => !busy && onClose()}
        className="absolute inset-0 bg-[rgba(22,21,46,0.35)]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        aria-describedby="share-body"
        className="relative flex w-full max-w-[480px] flex-col gap-3 rounded-list bg-raised p-6 shadow-pop"
      >
        <div className="flex items-start gap-3">
          <h2 id="share-title" className="flex-1 text-[20px] leading-[26px] font-semibold">
            Share this answer
          </h2>
          <button
            ref={close}
            type="button"
            aria-label="Close"
            onClick={() => !busy && onClose()}
            className="-mt-1 -mr-2 flex size-9 items-center justify-center rounded-full text-ink2 hover:bg-fill1"
          >
            <X aria-hidden size={18} />
          </button>
        </div>
        <p id="share-body" className="text-[15px] leading-[22px] text-ink2">
          A public, read-only page with this question, the answer and the names of its sources. The
          documents themselves are not shared, and later questions in this run never appear on it.
        </p>
        <div className="flex gap-2.5 rounded-inner bg-fill1 p-3.5">
          <Globe aria-hidden size={18} className="mt-0.5 shrink-0 text-ink2" />
          <p className="text-[14px] leading-[20px]">
            <span className="font-semibold">Anyone with the link can see it.</span>{" "}
            <span className="text-ink2">
              A detailed answer with sources may appear in search results.
            </span>
          </p>
        </div>

        {state.kind === "reading" && <p className="py-2 text-[14px] text-ink2">Checking…</p>}
        {error && (
          <p role="alert" className="text-[14px] text-danger">
            {error}
          </p>
        )}
        {state.kind === "shared" && (
          <div className="flex items-center gap-1 rounded-control bg-fill1 py-1 pr-1 pl-3.5">
            <input
              readOnly
              value={state.url}
              aria-label="Public link"
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
            />
            <button
              type="button"
              onClick={() => copy(state.url)}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-raised px-3.5 text-[14px] font-semibold shadow-card"
            >
              {copied ? <Check aria-hidden size={16} /> : <Copy aria-hidden size={16} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2.5 pt-1.5">
          {state.kind === "shared" ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => stop(state.token)}
                className="h-11 rounded-full px-5 text-[15px] font-semibold text-danger hover:bg-fill1 disabled:opacity-60"
              >
                {busy ? "Stopping…" : "Stop sharing"}
              </button>
              <a
                href={state.url}
                target="_blank"
                rel="noopener"
                className="inline-flex h-11 items-center rounded-full bg-fill2 px-5 text-[15px] font-semibold"
              >
                Open page
              </a>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className="h-11 rounded-full bg-fill2 px-5 text-[15px] font-semibold disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || state.kind === "reading"}
                onClick={create}
                className="h-11 rounded-full bg-act px-6 text-[15px] font-bold text-white hover:bg-act-press disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create public link"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
