"use client";

import { Check, Settings, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { setAgentEnabledAction, setChatModeAction } from "@/app/actions/prefs";
import type { AskMode } from "@/lib/agents/ask";
import type { AgentEntry } from "@/lib/agents/registry";
import { MODES } from "./ModePicker";

/** ON/OFF for one agent. Off hides it from the sidebar and Home and refuses its runs. */
export function AgentSwitch({ agent, enabled }: { agent: AgentEntry; enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  useEffect(() => setOn(enabled), [enabled]);

  function flip() {
    const next = !on;
    setOn(next);
    setFailed(false);
    start(async () => {
      const result = await setAgentEnabledAction(agent.id, next).catch(() => null);
      if (!result?.ok) {
        setOn(!next);
        setFailed(true);
      }
    });
  }

  return (
    <span className="flex items-center gap-2">
      {failed && (
        <span role="alert" className="text-[12px] text-danger">
          Not saved
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${agent.name}: ${on ? "on" : "off"}`}
        title={on ? `Turn ${agent.name} off` : `Turn ${agent.name} on`}
        onClick={flip}
        disabled={pending}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
          on ? "bg-act" : "bg-fill2"
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow-card transition-transform ${
            on ? "translate-x-5" : ""
          }`}
        />
      </button>
    </span>
  );
}

/** Chat's settings: the mode a new chat starts in. */
export function ChatSettingsButton({ mode }: { mode: AskMode }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(mode);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setCurrent(mode), [mode]);

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

  function pick(next: AskMode) {
    const before = current;
    setCurrent(next);
    setFailed(false);
    start(async () => {
      const result = await setChatModeAction(next).catch(() => null);
      if (!result?.ok) {
        setCurrent(before);
        setFailed(true);
      }
    });
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Chat settings"
        title="Chat settings"
        onClick={() => setOpen((o) => !o)}
        className={`flex size-9 items-center justify-center rounded-full text-ink2 hover:bg-fill1 hover:text-ink ${
          open ? "bg-fill1 text-ink" : ""
        }`}
      >
        <Settings aria-hidden size={18} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Chat settings"
          className="absolute bottom-full left-0 z-30 mb-2 w-80 rounded-control bg-raised p-3 shadow-pop"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-bold">Chat settings</h3>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="flex size-7 items-center justify-center rounded-full text-ink2 hover:bg-fill1"
            >
              <X aria-hidden size={16} />
            </button>
          </div>
          <p className="mt-2 mb-1.5 text-[13px] font-semibold text-ink2">A new chat starts in</p>
          <div role="radiogroup" aria-label="A new chat starts in" className="flex flex-col">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={current === m.id}
                disabled={pending}
                onClick={() => pick(m.id)}
                className="flex w-full items-start gap-2.5 rounded-chip px-2 py-2 text-left hover:bg-fill1"
              >
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-act">
                  {current === m.id && <Check aria-hidden size={16} strokeWidth={2.4} />}
                </span>
                <span className="flex flex-col">
                  <span className="text-[15px] font-semibold">{m.label}</span>
                  <span className="text-[13px] leading-[18px] text-ink2">{m.description}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-ink2">
            {failed ? (
              <span className="text-danger">Not saved. Try again.</span>
            ) : (
              "You can still change it for one chat in the composer."
            )}
          </p>
        </div>
      )}
    </div>
  );
}
