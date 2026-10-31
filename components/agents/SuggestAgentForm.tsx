"use client";

import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { suggestAgentAction } from "@/app/actions/suggestions";

const MIN = 10;
const MAX = 2000;

/** The request form for the platform admin: users suggest agents, they cannot add them. */
export function SuggestAgentForm() {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const length = text.trim().length;

  function send() {
    setError(null);
    start(async () => {
      const res = await suggestAgentAction(text);
      if (res.ok) {
        setSent(true);
        setText("");
      } else {
        setError(
          res.error === "invalid_text"
            ? `Write between ${MIN} and ${MAX.toLocaleString("en-US")} characters.`
            : "Your suggestion couldn't be sent. Try again.",
        );
      }
    });
  }

  if (sent) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-card bg-card p-6 shadow-card">
        <CircleCheck aria-hidden size={28} className="text-ok" />
        <div className="flex flex-col gap-1">
          <h2 className="text-[22px] font-bold">Thanks, it's sent</h2>
          <p className="text-[15px] leading-[22px] text-ink2">
            The Plugent team reads every suggestion.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link
            href="/agents"
            className="inline-flex h-11 items-center rounded-full bg-fill2 px-5 text-[15px] font-semibold"
          >
            All agents
          </Link>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="h-11 rounded-full px-5 text-[15px] font-semibold text-link"
          >
            Suggest another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className="flex flex-col gap-4 rounded-card bg-card p-6 shadow-card"
    >
      <label htmlFor="suggestion" className="text-[15px] font-semibold">
        What should the agent do?
      </label>
      <textarea
        id="suggestion"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        maxLength={MAX}
        placeholder="For example: read a service report photo and fill in our warranty claim form from the manufacturer's manuals."
        className="resize-y rounded-control bg-fill1 p-3.5 text-[16px] leading-6 outline-none placeholder:text-ink2 focus-visible:ring-2 focus-visible:ring-act/35 focus-visible:outline-none"
      />
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 text-[13px] text-ink2 tabular-nums">
          {length < MIN
            ? `At least ${MIN} characters`
            : `${length.toLocaleString("en-US")} / ${MAX.toLocaleString("en-US")}`}
        </span>
        <button
          type="submit"
          disabled={pending || length < MIN}
          className="h-11 rounded-full bg-act px-6 text-[15px] font-bold text-white hover:bg-act-press disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send suggestion"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[15px] text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
