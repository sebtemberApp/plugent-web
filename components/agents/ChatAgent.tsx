"use client";

import { ArrowUp, BookOpen, Check, Copy, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { sendFeedbackAction } from "@/app/actions/feedback";
import { formatTokens, useBalance } from "@/components/shell/BalanceContext";
import { RunMenu } from "@/components/shell/RunMenu";
import { AgentIcon } from "@/components/ui/AgentIcon";
import type { AskMode } from "@/lib/agents/ask";
import { type AgentId, agentById } from "@/lib/agents/registry";
import type { StoredTurn } from "@/lib/runs";
import { AgentError } from "./AgentError";
import { AnswerText } from "./AnswerText";
import { ChatOutline, outlineTitle, turnAnchor } from "./ChatOutline";
import { ModePicker } from "./ModePicker";

export type Source = {
  n: number;
  fileName: string;
  catalogueName: string | null;
  page: string | null;
  /** Another user's published catalogue; absent on an older Plugent answer. */
  library?: boolean;
  /** Whose content it is: `null` = the user's own; absent on an older Plugent answer. */
  owner?: string | null;
};

/** The answer's content owners for its "Source:" row, as Sebtember chat shows them: the
 *  user's own first as "You", then each other owner once, in citation order. */
export function ownersOf(sources: Source[]): { label: string; own: boolean }[] {
  const others: string[] = [];
  let own = false;
  for (const src of sources) {
    const owner = src.owner === undefined ? (src.library ? "Library" : null) : src.owner;
    if (owner === null) own = true;
    else if (!others.includes(owner)) others.push(owner);
  }
  return [
    ...(own ? [{ label: "You", own: true }] : []),
    ...others.map((label) => ({ label, own: false })),
  ];
}

type Turn = {
  id: string;
  question: string;
  state:
    | { kind: "pending"; deep: boolean }
    | {
        kind: "answer";
        answer: string;
        sources: Source[];
        tokens: number;
        charged: boolean;
        /** Chat asked a clarifying question (`answer` is the question): its chips. */
        clarify?: { question: string; options: string[] };
      }
    | { kind: "not_covered"; tokens: number }
    | { kind: "error"; code: string };
};

const MAX_QUESTION_CHARS = 2000;

/** The agents that run as a thread of typed requests and answer cards. */
export type ThreadAgent = "chat" | "specification" | "quotation";

/** What differs between the thread agents: where a request goes, and the words around it. */
const UI: Record<
  ThreadAgent,
  {
    body: (text: string, runId: string | null, mode: AskMode) => object;
    endpoint: string;
    newTitle: string;
    emptyTitle: string;
    emptyText: string;
    placeholder: string;
    followUp: string;
    pending: string;
    unit: [string, string];
    /** Source cards under the answer; a specification cites no files, so it shows none. */
    sourceCards: boolean;
    modes: boolean;
  }
> = {
  chat: {
    endpoint: "/api/agents/ask",
    body: (question, runId, mode) => ({ question, runId, mode }),
    newTitle: "New chat",
    emptyTitle: "Ask your knowledge",
    emptyText:
      "The answer comes only from your Sebtember catalogues (paused ones are skipped), with the documents it used. Follow-up questions keep the conversation.",
    placeholder: "Ask a question about your documents",
    followUp: "Ask a question about your documents",
    pending: "Searching your catalogues and writing the answer…",
    unit: ["question", "questions"],
    sourceCards: true,
    modes: true,
  },
  specification: {
    endpoint: "/api/agents/spec",
    body: (text, runId) => ({ agent: "specification", text, runId }),
    newTitle: "New specification",
    emptyTitle: "Write a specification",
    emptyText:
      "Name one device or material. You get its parameters, specification, installation and operation notes, drafted from your Sebtember catalogues.",
    placeholder: "Name a device or material, e.g. 12 kW air-to-water heat pump",
    followUp: "Refine it, e.g. add the noise data at night mode",
    pending: "Reading your catalogues and drafting the specification…",
    unit: ["request", "requests"],
    sourceCards: false,
    modes: false,
  },
  quotation: {
    endpoint: "/api/agents/spec",
    body: (text, runId) => ({ agent: "quotation", text, runId }),
    newTitle: "New quotation",
    emptyTitle: "Write a tender specification",
    emptyText:
      "Name one device or material. You get a brand-neutral tender specification to send to suppliers, drafted from your Sebtember catalogues.",
    placeholder: "Name a device or material, e.g. ventilation unit 800 m³/h",
    followUp: "Refine it, e.g. add a requirement for the filters",
    pending: "Reading your catalogues and drafting the tender text…",
    unit: ["request", "requests"],
    sourceCards: false,
    modes: false,
  },
};

/** Chat's own sentences for a failed turn; `AgentError` has the shared ones. */
function errorMessages(name: string): Record<string, string> {
  return {
    agent_off: `${name} is turned off. Turn it on in All agents to use it again.`,
    invalid_question: "Type something first (up to 2,000 characters).",
    run_not_found: "This run was deleted. Start a new one to continue.",
  };
}

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
            ...(t.clarify ? { clarify: t.clarify } : {}),
          }
        : { kind: "not_covered", tokens: t.tokens },
  }));
}

/**
 * A thread agent: Chat, Specification or Quotation (`UI` holds what differs).
 * Chat (milestone 3's Ask, restyled): each question is answered from the
 * catalogues (minus the paused ones), with its sources as cards, and saved into the run. The first
 * answer of a new chat gives it its URL and a row in the sidebar. A follow-up continues the
 * conversation: the model sees the run's last 10 messages.
 */
export function ChatAgent({
  runId: initialRunId,
  title: initialTitle,
  initialTurns,
  off,
  defaultMode,
  agent: agentId = "chat",
}: {
  agent?: ThreadAgent;
  runId: string | null;
  title: string | null;
  initialTurns: StoredTurn[];
  /** Turned off on All agents: the chat is readable, the composer is not offered. */
  off: boolean;
  /** Chat settings' mode for a new chat. */
  defaultMode: AskMode;
}) {
  const ui = UI[agentId];
  const agent = agentById(agentId);
  const { spent } = useBalance();
  const router = useRouter();
  const [runId, setRunId] = useState(initialRunId);
  const [title, setTitle] = useState(initialTitle);
  const [turns, setTurns] = useState<Turn[]>(() => fromStored(initialTurns));
  const [question, setQuestion] = useState("");
  // Standard or Deeper thinking: starts at Chat settings' default, and a change here
  // lasts for this chat's questions.
  const [mode, setMode] = useState<AskMode>(defaultMode);
  const nextId = useRef(1);
  // Which run the page shows, as a count: it moves when another run is opened here and when
  // the page goes away. An answer that lands after it moved belongs to a run the user left,
  // so it must not take over the URL or this thread.
  const shown = useRef(0);
  useEffect(
    () => () => {
      shown.current++;
    },
    [],
  );

  // Another run (or a new chat) opened from the sidebar: show it. The URL this page gave
  // its own new run arrives here too, and changes nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a different run resets
  useEffect(() => {
    if (initialRunId === runId) {
      setTitle(initialTitle);
      return;
    }
    shown.current++;
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

  /** Sends the composer's text, or `picked`: a clarifying question's chip. */
  async function ask(picked?: string) {
    const q = (picked ?? question).trim();
    if (!q || busy) return;
    const id = `local-${nextId.current++}`;
    setTurns((t) => [
      ...t,
      { id, question: q, state: { kind: "pending", deep: ui.modes && mode === "deep" } },
    ]);
    if (picked === undefined) setQuestion("");
    const view = shown.current;
    const settle = (state: Turn["state"], storedId?: unknown) =>
      setTurns((t) =>
        t.map((turn) =>
          turn.id === id
            ? { ...turn, state, ...(typeof storedId === "string" ? { id: storedId } : {}) }
            : turn,
        ),
      );
    try {
      const res = await fetch(ui.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ui.body(q, runId, mode)),
      });
      const data = await res.json().catch(() => ({ error: `http_${res.status}` }));
      if (typeof data.balanceAfter === "number") spent(data.balanceAfter);
      // The user opened another run, or left, while this one worked: it is saved, so the
      // sidebar gains it, and the page stays where the user went.
      if (shown.current !== view) {
        if (res.ok) router.refresh();
        return;
      }
      if (!res.ok) return fail(String(data.error ?? res.status));
      if (typeof data.runId === "string") {
        if (data.runId !== runId) {
          setRunId(data.runId);
          router.replace(`${agent.href}/${data.runId}`, { scroll: false });
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
              ...(data.clarify ? { clarify: data.clarify } : {}),
            }
          : { kind: "not_covered", tokens: data.tokens },
        data.turnId,
      );
    } catch {
      if (shown.current === view) fail("unreachable");
    }

    /** A failed turn gives its text back to the composer, so a retry is one click. */
    function fail(code: string) {
      settle({ kind: "error", code });
      setQuestion((current) => current || q);
    }
  }

  /** Asks a failed turn's question again in its place. */
  function retry(failed: Turn) {
    setTurns((t) => t.filter((turn) => turn.id !== failed.id));
    setQuestion((current) => (current.trim() === failed.question ? "" : current));
    void ask(failed.question);
  }

  const used = turns.reduce(
    (sum, t) => sum + ("tokens" in t.state ? (t.state as { tokens: number }).tokens : 0),
    0,
  );
  const asked = turns.length;

  return (
    <main className="flex min-h-[calc(100dvh-56px)] flex-1 flex-col min-[900px]:min-h-dvh">
      <header className="flex items-center gap-3 border-hair border-b-[0.5px] px-4 py-3.5 min-[600px]:px-8">
        <AgentIcon agent={agent} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-[17px] font-bold">
            {title ?? turns[0]?.question ?? ui.newTitle}
          </h1>
          <p className="text-[13px] text-ink2">
            {agent.name}
            {asked > 0 &&
              ` · ${asked} ${ui.unit[asked === 1 ? 0 : 1]} · ${formatTokens(used)} tokens`}
          </p>
        </div>
        {runId && (
          <RunMenu
            runId={runId}
            title={title ?? turns[0]?.question ?? ui.newTitle}
            leaveTo={agent.href}
            onRenamed={setTitle}
          />
        )}
      </header>

      <div className="@container relative flex flex-1 flex-col">
        <ChatOutline
          entries={turns.flatMap((t) => {
            if (t.state.kind !== "answer") return [];
            const title = outlineTitle(t.state.answer);
            return title ? [{ id: t.id, title }] : [];
          })}
        />
        <div className="mx-auto flex w-full max-w-[820px] flex-1 flex-col gap-5 px-4 py-7 min-[600px]:px-8">
          {turns.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
              <AgentIcon agent={agent} size="card" />
              <h2 className="text-[22px] font-bold">{ui.emptyTitle}</h2>
              <p className="max-w-[440px] text-[15px] leading-[22px] text-ink2">{ui.emptyText}</p>
            </div>
          )}
          {turns.map((turn, i) => (
            <TurnView
              key={turn.id}
              turn={turn}
              runId={runId}
              first={i === 0}
              latest={i === turns.length - 1 && !busy}
              onOption={(option) => void ask(option)}
              onRetry={retry}
              agentId={agentId}
              name={agent.name}
              pending={ui.pending}
              sourceCards={ui.sourceCards}
            />
          ))}
          <div ref={end} />
        </div>
      </div>
      <div className="sticky bottom-0 mx-auto w-full max-w-[820px] bg-gradient-to-t from-page from-70% to-transparent px-4 pt-3 pb-4 min-[600px]:px-8 min-[600px]:pb-6">
        {off ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-card px-5 py-4 shadow-card">
            <p className="text-[15px] text-ink2">
              {agent.name} is turned off, so you can read this run but not add to it.
            </p>
            <Link href="/agents" className="text-link text-[15px] font-semibold">
              Turn it on in All agents
            </Link>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
            className="flex flex-col gap-2 rounded-card bg-card py-3 pr-3 pl-[18px] shadow-card focus-within:ring-2 focus-within:ring-act/35"
          >
            <label htmlFor="chat-question" className="sr-only">
              {turns.length === 0 ? ui.placeholder : ui.followUp}
            </label>
            <textarea
              id="chat-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void ask();
                }
              }}
              rows={2}
              maxLength={MAX_QUESTION_CHARS}
              placeholder={turns.length === 0 ? ui.placeholder : ui.followUp}
              className="resize-none bg-transparent pt-1 text-[16px] leading-6 outline-none placeholder:text-ink2 focus-visible:outline-none"
            />
            <div className="flex items-center gap-2">
              {ui.modes && <ModePicker mode={mode} onChange={setMode} disabled={busy} />}
              <span className="flex-1 truncate text-[13px] text-ink2 max-[520px]:hidden">
                Enter to send, Shift+Enter for a new line
              </span>
              <span className="flex-1 min-[521px]:hidden" />
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
        )}
      </div>
    </main>
  );
}

function TurnView({
  turn,
  runId,
  first,
  name,
  pending,
  sourceCards,
  latest,
  onOption,
  onRetry,
  agentId,
}: {
  agentId: ThreadAgent;
  turn: Turn;
  runId: string | null;
  /** The last turn of the chat: only its clarifying chips can be picked (sebtember's rule). */
  latest: boolean;
  onOption: (option: string) => void;
  /** A failed turn asked again, as the latest turn. */
  onRetry: (turn: Turn) => void;
  name: string;
  pending: string;
  sourceCards: boolean;
  /** A follow-up question gets extra room above it, to set it apart from the last answer. */
  first: boolean;
}) {
  const s = turn.state;
  // A turn answered on this page has a local id until the answer names its stored one.
  const storedId = turn.id.startsWith("local-") ? null : turn.id;
  return (
    <>
      <div
        id={turnAnchor(turn.id)}
        className={`max-w-[80%] scroll-mt-6 self-end rounded-list bg-fill2 px-4 py-3 text-[16px] leading-6 whitespace-pre-wrap ${first ? "" : "mt-7"}`}
      >
        {turn.question}
      </div>
      {s.kind === "pending" && (
        <div className="flex items-center gap-3 rounded-card bg-card px-6 py-5 text-[15px] text-ink2 shadow-card">
          <span className="size-2 animate-pulse rounded-full bg-act" />
          {s.deep ? "Searching your catalogues and thinking it through…" : pending}
        </div>
      )}
      {s.kind === "error" && (
        <AgentError
          code={s.code}
          messages={errorMessages(name)}
          onRetry={latest ? () => onRetry(turn) : undefined}
        />
      )}
      {s.kind === "not_covered" && (
        <article className="flex flex-col gap-3 rounded-card bg-card px-6 py-5 shadow-card">
          <p className="text-[16px] leading-[26px]">
            Your catalogues don't seem to cover this. Try other words, or check in{" "}
            <Link href="/knowledge" className="text-link font-semibold">
              Knowledge
            </Link>{" "}
            that the right catalogue isn't paused.
          </p>
          <AnswerFooter
            owners={[]}
            agent={agentId}
            runId={runId}
            turnId={storedId}
            question={turn.question}
            answer=""
          />
        </article>
      )}
      {s.kind === "answer" && s.clarify && (
        <article className="flex flex-col gap-3 rounded-card bg-card px-6 py-5 shadow-card">
          <p className="text-[16px] leading-[26px]">{s.clarify.question}</p>
          <div className="flex flex-wrap gap-2">
            {s.clarify.options.map((option) => (
              <button
                key={option}
                type="button"
                disabled={!latest}
                onClick={() => onOption(option)}
                className="rounded-full bg-fill1 px-4 py-2 text-[15px] font-semibold hover:bg-fill2 disabled:opacity-50 disabled:hover:bg-fill1"
              >
                {option}
              </button>
            ))}
          </div>
        </article>
      )}
      {s.kind === "answer" && !s.clarify && (
        <article className="flex flex-col gap-4 rounded-card bg-card px-6 py-5 shadow-card">
          <AnswerText text={s.answer} />
          {sourceCards && s.sources.length > 0 && (
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
            owners={ownersOf(s.sources)}
            charged={s.charged}
            agent={agentId}
            runId={runId}
            turnId={storedId}
            question={turn.question}
            answer={s.answer}
            copy
          />
        </article>
      )}
    </>
  );
}

export function SourceCard({ source }: { source: Source }) {
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

/** The answer card's foot: whose content it drew on ("Source:") on the left, its actions
 *  on the right. The tokens are in the run's header, not here.
 *  One Feedback icon (no like / dislike) opens a short note to the platform admin. */
export function AnswerFooter({
  owners,
  charged = true,
  agent,
  runId,
  turnId = null,
  question,
  answer,
  copy = false,
}: {
  owners: { label: string; own: boolean }[];
  charged?: boolean;
  /** Whose answer it is, for the feedback note (the stored run's agent wins on the server). */
  agent: AgentId;
  runId: string | null;
  /** The stored turn, when there is one: the feedback quotes it from the store. */
  turnId?: string | null;
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
      const res = await sendFeedbackAction({ agent, runId, turnId, question, answer, text }).catch(
        () => ({
          ok: false as const,
          error: "unreachable",
        }),
      );
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
        {owners.length > 0 && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-[13px] text-ink2">Source:</span>
            {owners.map((o) => (
              <span
                key={o.label}
                className={`max-w-[180px] truncate rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${
                  o.own ? "bg-k-own/15 text-k-own" : "bg-k-lib/13 text-k-lib"
                }`}
              >
                {o.label}
              </span>
            ))}
          </div>
        )}
        {!charged && (
          <span className="text-[13px] text-ink2">Not charged yet: billing will try again</span>
        )}
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
