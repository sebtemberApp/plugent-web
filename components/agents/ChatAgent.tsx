"use client";

import { ArrowUp, BookOpen, Check, Copy, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useId, useState, useTransition } from "react";
import { sendFeedbackAction } from "@/app/actions/feedback";
import { formatTokens, useBalance } from "@/components/shell/BalanceContext";
import { AgentIcon } from "@/components/ui/AgentIcon";
import { agentById } from "@/lib/agents/registry";
import type { StoredTurn } from "@/lib/runs";
import { AnswerText } from "./AnswerText";

type Source = {
  n: number;
  fileName: string;
  catalogueName: string | null;
  page: string | null;
  /** Another user's published catalogue; absent on an older Plugent answer. */
  library?: boolean;
};

type Turn = {
  id: string;
  question: string;
  state:
    | { kind: "pending" }
    | {
        kind: "answer";
        answer: string;
        sources: Source[];
        tokens: number;
        charged: boolean;
      }
    | { kind: "not_covered"; tokens: number }
    | { kind: "error"; code: string };
};

const MAX_QUESTION_CHARS = 2000;
const chat = agentById("chat");

const ERRORS: Record<string, string> = {
  low_balance: "Your Sebtember balance is too low for this. Top it up from the account menu.",
  not_connected: "Plugent isn't connected to your Sebtember catalogues yet.",
  invalid_question: "Type a question first (up to 2,000 characters).",
  unauthorized: "Your session has ended. Reload the page to sign in again.",
  run_not_found: "This chat was deleted. Start a new chat to ask again.",
};

function fromStored(turns: StoredTurn[]): Turn[] {
  return turns.map((t) => ({
    id: t.id,
    question: t.question,
    state:
      t.kind === "answer"
        ? {
            kind: "answer",
            answer: t.answer,
            sources: t.sources,
            tokens: t.tokens,
            charged: t.charged,
          }
        : { kind: "not_covered", tokens: t.tokens },
  }));
}

/**
 * The Chat agent (milestone 3's Ask, restyled): each question is answered from the
 * connected catalogues, with its sources as cards, and saved into the run. The first
 * answer of a new chat gives it its URL and a row in the sidebar. Questions are still
 * answered on their own: the model does not see the earlier turns.
 */
export function ChatAgent({
  runId: initialRunId,
  title: initialTitle,
  initialTurns,
}: {
  runId: string | null;
  title: string | null;
  initialTurns: StoredTurn[];
}) {
  const { spent } = useBalance();
  const router = useRouter();
  const [runId, setRunId] = useState(initialRunId);
  const [title, setTitle] = useState(initialTitle);
  const [turns, setTurns] = useState<Turn[]>(() => fromStored(initialTurns));
  const [question, setQuestion] = useState("");
  const nextId = useRef(1);

  // Another run (or a new chat) opened from the sidebar: show it. The URL this page gave
  // its own new run arrives here too, and changes nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a different run resets
  useEffect(() => {
    if (initialRunId === runId) {
      setTitle(initialTitle);
      return;
    }
    setRunId(initialRunId);
    setTitle(initialTitle);
    setTurns(fromStored(initialTurns));
  }, [initialRunId, initialTitle]);
  const end = useRef<HTMLDivElement>(null);
  const busy = turns.at(-1)?.state.kind === "pending";

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every new turn or answer
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    const id = `local-${nextId.current++}`;
    setTurns((t) => [...t, { id, question: q, state: { kind: "pending" } }]);
    setQuestion("");
    const settle = (state: Turn["state"]) =>
      setTurns((t) => t.map((turn) => (turn.id === id ? { ...turn, state } : turn)));
    try {
      const res = await fetch("/api/agents/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, runId }),
      });
      const data = await res.json().catch(() => ({ error: `http_${res.status}` }));
      if (!res.ok) return settle({ kind: "error", code: String(data.error ?? res.status) });
      if (typeof data.balanceAfter === "number") spent(data.balanceAfter);
      if (typeof data.runId === "string") {
        if (data.runId !== runId) {
          setRunId(data.runId);
          router.replace(`/agents/chat/${data.runId}`, { scroll: false });
        }
        // The sidebar's history: the new run, or this one moved to the top.
        router.refresh();
      }
      settle(
        data.kind === "answer"
          ? {
              kind: "answer",
              answer: data.answer,
              sources: data.sources,
              tokens: data.tokens,
              charged: data.charged,
            }
          : { kind: "not_covered", tokens: data.tokens },
      );
    } catch {
      settle({ kind: "error", code: "unreachable" });
    }
  }

  const used = turns.reduce(
    (sum, t) => sum + ("tokens" in t.state ? (t.state as { tokens: number }).tokens : 0),
    0,
  );
  const asked = turns.length;

  return (
    <main className="flex min-h-[calc(100dvh-56px)] flex-1 flex-col min-[900px]:min-h-dvh">
      <header className="flex items-center gap-3 border-hair border-b-[0.5px] px-4 py-3.5 min-[600px]:px-8">
        <AgentIcon agent={chat} />
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-[17px] font-bold">
            {title ?? turns[0]?.question ?? "New chat"}
          </h1>
          <p className="text-[13px] text-ink2">
            Chat
            {asked > 0 &&
              ` · ${asked} ${asked === 1 ? "question" : "questions"} · ${formatTokens(used)} tokens`}
          </p>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[820px] flex-1 flex-col gap-5 px-4 py-7 min-[600px]:px-8">
        {turns.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
            <AgentIcon agent={chat} size="card" />
            <h2 className="text-[22px] font-bold">Ask your knowledge</h2>
            <p className="max-w-[440px] text-[15px] leading-[22px] text-ink2">
              The answer comes only from the Sebtember catalogues you connected, with the documents
              it used. Each question is answered on its own.
            </p>
          </div>
        )}
        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} runId={runId} />
        ))}
        <div ref={end} />
      </div>

      <div className="sticky bottom-0 mx-auto w-full max-w-[820px] bg-gradient-to-t from-page from-70% to-transparent px-4 pt-3 pb-4 min-[600px]:px-8 min-[600px]:pb-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
          className="flex flex-col gap-2 rounded-card bg-card py-3 pr-3 pl-[18px] shadow-card focus-within:ring-2 focus-within:ring-act/35"
        >
          <label htmlFor="chat-question" className="sr-only">
            Ask a question
          </label>
          <textarea
            id="chat-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ask();
              }
            }}
            rows={2}
            maxLength={MAX_QUESTION_CHARS}
            placeholder="Ask a question about your documents"
            className="resize-none bg-transparent pt-1 text-[16px] leading-6 outline-none placeholder:text-ink2 focus-visible:outline-none"
          />
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[13px] text-ink2">
              Enter to send, Shift+Enter for a new line
            </span>
            <button
              type="submit"
              aria-label="Send"
              disabled={busy || question.trim().length === 0}
              className="flex size-9 items-center justify-center rounded-full bg-act text-white hover:bg-act-press disabled:opacity-40"
            >
              <ArrowUp aria-hidden size={18} strokeWidth={2.2} />
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

function TurnView({ turn, runId }: { turn: Turn; runId: string | null }) {
  const s = turn.state;
  return (
    <>
      <div className="max-w-[80%] self-end rounded-list bg-fill2 px-4 py-3 text-[16px] leading-6 whitespace-pre-wrap">
        {turn.question}
      </div>
      {s.kind === "pending" && (
        <div className="flex items-center gap-3 rounded-card bg-card px-6 py-5 text-[15px] text-ink2 shadow-card">
          <span className="size-2 animate-pulse rounded-full bg-act" />
          Searching your catalogues and writing the answer…
        </div>
      )}
      {s.kind === "error" && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-card bg-card px-6 py-5 shadow-card"
        >
          <p className="text-[15px] text-danger">
            {ERRORS[s.code] ?? `Something went wrong (${s.code}). Try again.`}
          </p>
          {s.code === "not_connected" && (
            <Link href="/knowledge" className="text-link text-[15px] font-semibold">
              Connect catalogues
            </Link>
          )}
        </div>
      )}
      {s.kind === "not_covered" && (
        <article className="flex flex-col gap-3 rounded-card bg-card px-6 py-5 shadow-card">
          <p className="text-[16px] leading-[26px]">
            Your connected catalogues don't seem to cover this. Try other words, or{" "}
            <Link href="/knowledge" className="text-link font-semibold">
              connect more catalogues
            </Link>
            .
          </p>
          <AnswerFooter tokens={s.tokens} runId={runId} question={turn.question} answer="" />
        </article>
      )}
      {s.kind === "answer" && (
        <article className="flex flex-col gap-4 rounded-card bg-card px-6 py-5 shadow-card">
          <AnswerText text={s.answer} />
          {s.sources.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-ink2">Sources</span>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
                {s.sources.map((src) => (
                  <SourceCard key={src.n} source={src} />
                ))}
              </div>
            </div>
          )}
          <AnswerFooter
            tokens={s.tokens}
            charged={s.charged}
            runId={runId}
            question={turn.question}
            answer={s.answer}
            copy
          />
        </article>
      )}
    </>
  );
}

function SourceCard({ source }: { source: Source }) {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(source.fileName)?.[1]?.toUpperCase() ?? "FILE";
  const page = source.page ? `p. ${source.page}` : null;
  return (
    <div className="flex gap-2.5 rounded-inner bg-fill1 p-3">
      <span className="flex h-10 w-8 shrink-0 items-center justify-center rounded-[6px] bg-card text-[10px] font-bold text-ink2 shadow-card">
        {ext.slice(0, 4)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-[6px] bg-fill2 px-1 text-[12px] font-semibold text-ink2">
            {source.n}
          </span>
          <span className="truncate text-[13px] font-semibold" title={source.fileName}>
            {source.fileName}
          </span>
        </span>
        {(page || source.catalogueName || source.library) && (
          <span className="flex min-w-0 items-center gap-1 text-[12px] text-ink2">
            {page && <span className="shrink-0">{page}</span>}
            {page && (source.catalogueName || source.library) && <span aria-hidden>·</span>}
            {source.library && (
              <BookOpen aria-hidden size={13} strokeWidth={2} className="shrink-0 text-k-lib" />
            )}
            {(source.catalogueName || source.library) && (
              <span className={`truncate ${source.library ? "font-semibold text-k-lib" : ""}`}>
                {source.catalogueName ?? "Library"}
                {source.library && <span className="sr-only"> (Library catalogue)</span>}
              </span>
            )}
          </span>
        )}
      </span>
    </div>
  );
}

const ICON_BUTTON =
  "flex size-9 items-center justify-center rounded-chip text-ink2 hover:bg-fill1 hover:text-ink";

/** The answer card's foot: the tokens it cost on the left, its actions on the right.
 *  One Feedback icon (no like / dislike) opens a short note to the platform admin. */
function AnswerFooter({
  tokens,
  charged = true,
  runId,
  question,
  answer,
  copy = false,
}: {
  tokens: number;
  charged?: boolean;
  runId: string | null;
  question: string;
  answer: string;
  copy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fieldId = useId();

  function send() {
    const text = note.trim();
    if (!text) return;
    setError(null);
    start(async () => {
      const res = await sendFeedbackAction({ runId, question, answer, text }).catch(() => ({
        ok: false as const,
        error: "unreachable",
      }));
      if (res.ok) {
        setSent(true);
        setWriting(false);
        setNote("");
      } else {
        setError("Your feedback wasn't sent. Try again.");
      }
    });
  }

  return (
    <footer className="flex flex-col gap-2 border-hair border-t-[0.5px] pt-2">
      <div className="flex items-center gap-1">
        <span className="text-[13px] text-ink2 tabular-nums">
          {formatTokens(tokens)} tokens{charged ? "" : " (not charged: billing failed)"}
        </span>
        <span className="flex-1" />
        {sent && <span className="mr-1 text-[13px] text-ink2">Thanks for the feedback</span>}
        <button
          type="button"
          aria-label="Feedback on this answer"
          title="Feedback on this answer"
          aria-expanded={writing}
          onClick={() => setWriting((w) => !w)}
          className={`${ICON_BUTTON} ${writing ? "bg-fill1 text-ink" : ""}`}
        >
          <MessageSquareText aria-hidden size={18} />
        </button>
        {copy && (
          <button
            type="button"
            aria-label={copied ? "Copied" : "Copy the answer"}
            title="Copy the answer"
            onClick={() =>
              navigator.clipboard.writeText(answer).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
            className={ICON_BUTTON}
          >
            {copied ? <Check aria-hidden size={18} /> : <Copy aria-hidden size={18} />}
          </button>
        )}
      </div>
      {writing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex flex-col gap-2 rounded-inner bg-fill1 p-3"
        >
          <label htmlFor={fieldId} className="text-[13px] font-semibold text-ink2">
            What was wrong or missing? The Plugent team reads every note.
          </label>
          <textarea
            id={fieldId}
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="resize-none rounded-control bg-card px-3 py-2 text-[15px] leading-6 shadow-card outline-none focus:ring-2 focus:ring-act"
          />
          {error && <p className="text-[13px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setWriting(false)}
              className="h-9 rounded-full px-4 text-[15px] font-semibold hover:bg-fill2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || !note.trim()}
              className="h-9 rounded-full bg-act px-4 text-[15px] font-semibold text-white hover:bg-act-press disabled:opacity-40"
            >
              {pending ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      )}
    </footer>
  );
}
