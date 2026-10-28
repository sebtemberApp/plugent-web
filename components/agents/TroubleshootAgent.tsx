"use client";

import { AlertTriangle, ArrowUp, Check, ImagePlus, Info, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatTokens, useBalance } from "@/components/shell/BalanceContext";
import { RunMenu } from "@/components/shell/RunMenu";
import { AgentIcon } from "@/components/ui/AgentIcon";
import { agentById } from "@/lib/agents/registry";
import {
  ENOUGH_CONTEXT_COPY,
  type StepCalloutTone,
  type StepOutcomeKind,
} from "@/lib/agents/troubleshoot-prompts";
import type { TsState, TsTurn } from "@/lib/runs";
import { AgentError } from "./AgentError";
import { AnswerFooter, ownersOf, SourceCard } from "./ChatAgent";
import { MicButton } from "./MicButton";

const agent = agentById("troubleshooting");
const MAX_STEPS = 8;
const MAX_TEXT_CHARS = 4000;
/** The photo as the model reads it: longest side, JPEG quality. */
const PHOTO_SIDE = 1024;
const THUMB_SIDE = 240;
const MAX_PHOTO_CHARS = 900_000;

type Photo = { mediaType: string; data: string; thumb: string };
type Pending = { text: string; thumb: string | null; outcome: boolean } | null;

/** Troubleshooting's own sentences for a failed turn; `AgentError` has the shared ones. */
const ERRORS: Record<string, string> = {
  agent_off: "Troubleshooting is turned off. Turn it on in All agents to use it again.",
  invalid_question: "Describe the problem first (up to 4,000 characters), or add a photo.",
  invalid_photo: "That photo couldn't be read. Try a JPEG or PNG.",
  run_not_found: "This troubleshooting was deleted. Start a new one.",
  busy: "The previous answer is still being worked out. Wait a moment and try again.",
  finished: "This troubleshooting is finished. Start a new one.",
  not_current_step: "Only the current step can be answered. Reload the page to see it.",
};

/** Downscales a picked image twice: once for the model, once as the thread's thumbnail. */
async function readPhoto(file: File): Promise<Photo> {
  const bitmap = await createImageBitmap(file);
  const draw = (side: number, quality: number) => {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  };
  let full = draw(PHOTO_SIDE, 0.82);
  if (full.length > MAX_PHOTO_CHARS) full = draw(PHOTO_SIDE, 0.6);
  const thumb = draw(THUMB_SIDE, 0.7);
  bitmap.close();
  return { mediaType: "image/jpeg", data: full.slice(full.indexOf(",") + 1), thumb };
}

/**
 * Troubleshooting: describe a fault (text, a photo), answer at most two clarifying questions,
 * then work through one step at a time from your own documents. A finished step collapses
 * to its one-line outcome and stays in the thread.
 */
export function TroubleshootAgent({
  runId: initialRunId,
  title: initialTitle,
  initialState,
  initialTurns,
  off,
}: {
  runId: string | null;
  title: string | null;
  initialState: TsState;
  initialTurns: TsTurn[];
  off: boolean;
}) {
  const { spent } = useBalance();
  const router = useRouter();
  const [runId, setRunId] = useState(initialRunId);
  const [title, setTitle] = useState(initialTitle);
  const [state, setState] = useState(initialState);
  const [turns, setTurns] = useState(initialTurns);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  // Which run the page shows, as a count: it moves when another run is opened here and when the
  // page goes away, so a reply that lands after that cannot take over the URL (audit B1).
  const shown = useRef(0);
  // The last request, for the error card's Retry.
  const lastSent = useRef<Parameters<typeof send>[0] | null>(null);
  useEffect(
    () => () => {
      shown.current++;
    },
    [],
  );

  // Another run (or a new one) opened from the sidebar: show it. The URL this page gave its
  // own new run arrives here too, and changes nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a different run resets
  useEffect(() => {
    if (initialRunId === runId) {
      setTitle(initialTitle);
      return;
    }
    shown.current++;
    setRunId(initialRunId);
    setTitle(initialTitle);
    setState(initialState);
    setTurns(initialTurns);
    setPending(null);
    setError(null);
  }, [initialRunId, initialTitle]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every new turn
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending]);

  const busy = pending !== null;
  const finished = state.status === "resolved" || state.status === "exhausted";
  const used = turns.reduce(
    (sum, t) => sum + (t.role === "step" || t.role === "end" ? t.tokens : 0),
    0,
  );

  async function send(body: {
    text?: string;
    outcome?: { stepId: string; kind: StepOutcomeKind };
    label?: string;
  }) {
    if (busy) return;
    lastSent.current = body;
    const view = shown.current;
    const outgoing = body.outcome ? null : photo;
    setPending({
      text: body.label ?? body.text ?? "",
      thumb: outgoing?.thumb ?? null,
      outcome: Boolean(body.outcome),
    });
    setError(null);
    if (!body.outcome) {
      setText("");
      setPhoto(null);
    }
    try {
      const res = await fetch("/api/agents/troubleshoot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId,
          text: body.text,
          outcome: body.outcome,
          photo: outgoing ? { mediaType: outgoing.mediaType, data: outgoing.data } : undefined,
          thumb: outgoing?.thumb,
        }),
      });
      const data = await res.json().catch(() => ({ error: `http_${res.status}` }));
      if (typeof data.balanceAfter === "number") spent(data.balanceAfter);
      // The user opened another run, or left: the reply is saved, the page stays where they went.
      if (shown.current !== view) {
        if (res.ok) router.refresh();
        return;
      }
      if (!res.ok) {
        setError(String(data.error ?? res.status));
        if (!body.outcome) {
          setText(body.text ?? "");
          setPhoto(outgoing);
        }
        return;
      }
      setState(data.state);
      setTurns((ts) => {
        const done = (data.turns as TsTurn[]).find((t) => t.role === "user")?.outcome;
        const updated = done
          ? ts.map((t) =>
              t.id === done.stepId && t.role === "step"
                ? { ...t, done: { kind: done.kind, label: done.label } }
                : t,
            )
          : ts;
        return [...updated, ...data.turns];
      });
      if (data.runId !== runId) {
        setRunId(data.runId);
        router.replace(`${agent.href}/${data.runId}`, { scroll: false });
      }
      router.refresh();
    } catch {
      if (shown.current === view) setError("unreachable");
    } finally {
      if (shown.current === view) setPending(null);
    }
  }

  function submit() {
    const t = text.trim();
    if ((!t && !photo) || busy) return;
    send({ text: t });
  }

  const lastId = turns.at(-1)?.id;
  const header = finished
    ? state.status === "resolved"
      ? "Solved"
      : "No more steps"
    : state.stepCount > 0
      ? `step ${state.stepCount} of up to ${MAX_STEPS}`
      : null;

  return (
    <main className="flex min-h-[calc(100dvh-56px)] flex-1 flex-col min-[900px]:min-h-dvh">
      <header className="flex items-center gap-3 border-hair border-b-[0.5px] px-4 py-3.5 min-[600px]:px-8">
        <AgentIcon agent={agent} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-[17px] font-bold">{title ?? "New troubleshooting"}</h1>
          <p className="text-[13px] text-ink2">
            Troubleshooting
            {header && ` · ${header}`}
            {used > 0 && ` · ${formatTokens(used)} tokens`}
          </p>
        </div>
        {runId && (
          <RunMenu
            runId={runId}
            title={title ?? "New troubleshooting"}
            leaveTo={agent.href}
            onRenamed={setTitle}
          />
        )}
      </header>

      <div className="mx-auto flex w-full max-w-[820px] flex-1 flex-col gap-4 px-4 py-7 min-[600px]:px-8">
        {turns.length === 0 && !pending && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
            <AgentIcon agent={agent} size="card" />
            <h2 className="text-[22px] font-bold">Fix a fault, step by step</h2>
            <p className="max-w-[460px] text-[15px] leading-[22px] text-ink2">
              Describe the problem, or add a photo of the display or the part. You get one step at a
              time from your own manuals, and tell the agent what happened.
            </p>
          </div>
        )}
        {turns.map((turn) => (
          <TurnView
            key={turn.id}
            turn={turn}
            runId={runId}
            latest={turn.id === lastId && !busy && !finished}
            onOption={(option) => send({ text: option })}
            onOutcome={(stepId, kind, label) => send({ outcome: { stepId, kind }, label })}
          />
        ))}
        {pending && (
          <>
            {pending.text || pending.thumb ? (
              <UserBubble text={pending.text} thumb={pending.thumb} outcome={pending.outcome} />
            ) : null}
            <div className="flex items-center gap-3 rounded-card bg-card px-6 py-5 text-[15px] text-ink2 shadow-card">
              <span className="size-2 animate-pulse rounded-full bg-act" />
              {pending.outcome || state.status === "stepping"
                ? "Searching your manuals for the next step…"
                : "Reading the problem…"}
            </div>
          </>
        )}
        {error && (
          <AgentError
            code={error}
            messages={ERRORS}
            onRetry={lastSent.current ? () => send(lastSent.current ?? {}) : undefined}
          />
        )}
        <div ref={end} />
      </div>

      <div className="sticky bottom-0 mx-auto w-full max-w-[820px] bg-gradient-to-t from-page from-70% to-transparent px-4 pt-3 pb-4 min-[600px]:px-8 min-[600px]:pb-6">
        {off ? (
          <Notice text="Troubleshooting is turned off, so you can read this run but not add to it.">
            <Link href="/agents" className="text-link text-[15px] font-semibold">
              Turn it on in All agents
            </Link>
          </Notice>
        ) : finished ? (
          <Notice
            text={
              state.status === "resolved"
                ? "This problem is solved."
                : "Your documents have no more steps for this problem."
            }
          >
            <Link href={agent.href} className="text-link text-[15px] font-semibold">
              Start a new troubleshooting
            </Link>
          </Notice>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex flex-col gap-2 rounded-card bg-card py-3 pr-3 pl-[18px] shadow-card focus-within:ring-2 focus-within:ring-act/35"
          >
            {photo && (
              <div className="relative self-start">
                {/* biome-ignore lint/performance/noImgElement: a local data URL, not an asset */}
                <img
                  src={photo.thumb}
                  alt="What you are adding"
                  className="h-16 w-16 rounded-inner object-cover"
                />
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => setPhoto(null)}
                  className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-ink text-page"
                >
                  <X aria-hidden size={14} />
                </button>
              </div>
            )}
            <label htmlFor="ts-text" className="sr-only">
              {turns.length === 0 ? "Describe the problem" : "Tell us what happened"}
            </label>
            <textarea
              id="ts-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={2}
              maxLength={MAX_TEXT_CHARS}
              placeholder={
                turns.length === 0
                  ? "Describe the problem, or add a photo"
                  : "Tell us what happened, or add a photo"
              }
              className="resize-none bg-transparent pt-1 text-[16px] leading-6 outline-none placeholder:text-ink2 focus-visible:outline-none"
            />
            <div className="flex items-center gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                className="hidden"
                onChange={(e) => {
                  // The list is live: read the file before clearing the input.
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  readPhoto(file)
                    .then(setPhoto)
                    .catch(() => setError("invalid_photo"));
                }}
              />
              <button
                type="button"
                aria-label="Add a photo"
                title="Add a photo"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
                className="flex size-9 items-center justify-center rounded-full text-ink2 hover:bg-fill1 hover:text-ink disabled:opacity-40"
              >
                <ImagePlus aria-hidden size={19} />
              </button>
              <span className="flex-1 truncate text-[13px] text-ink2">
                Steps only from your documents
              </span>
              <MicButton
                disabled={busy}
                onText={(spoken) =>
                  setText((t) => (t.trim() ? `${t.trimEnd()} ${spoken}` : spoken))
                }
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={busy || (text.trim().length === 0 && !photo)}
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

function Notice({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-card px-5 py-4 shadow-card">
      <p className="text-[15px] text-ink2">{text}</p>
      {children}
    </div>
  );
}

function UserBubble({
  text,
  thumb,
  outcome,
}: {
  text: string;
  thumb: string | null;
  outcome: boolean;
}) {
  return (
    <div className="flex max-w-[80%] flex-col items-end gap-2 self-end">
      {thumb && (
        // biome-ignore lint/performance/noImgElement: a stored data URL, not an asset
        <img src={thumb} alt="The problem, as sent" className="h-32 rounded-inner object-cover" />
      )}
      {text && (
        <div
          className={`rounded-list px-4 py-3 text-[16px] leading-6 whitespace-pre-wrap ${
            outcome ? "bg-sel font-semibold" : "bg-fill2"
          }`}
        >
          {text}
        </div>
      )}
    </div>
  );
}

const CALLOUT: Record<StepCalloutTone, string> = {
  info: "bg-fill1 text-ink",
  success: "bg-ok/10 text-ok",
  warning: "bg-warn/12 text-warn",
  critical: "bg-danger/10 text-danger",
};

function TurnView({
  turn,
  runId,
  latest,
  onOption,
  onOutcome,
}: {
  turn: TsTurn;
  runId: string | null;
  /** The thread's last turn, while it can still be answered. */
  latest: boolean;
  onOption: (option: string) => void;
  onOutcome: (stepId: string, kind: StepOutcomeKind, label: string) => void;
}) {
  if (turn.role === "user") {
    return <UserBubble text={turn.text} thumb={turn.thumb} outcome={turn.outcome !== null} />;
  }
  if (turn.role === "context") {
    return <p className="px-1 text-[15px] text-ink2">{ENOUGH_CONTEXT_COPY}</p>;
  }
  if (turn.role === "clarify") {
    return (
      <article className="flex flex-col gap-3 rounded-card bg-card px-6 py-5 shadow-card">
        <p className="text-[16px] leading-[26px]">{turn.question}</p>
        <div className="flex flex-wrap gap-2">
          {turn.options.map((option) => (
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
    );
  }
  if (turn.role === "step" && turn.done) {
    return (
      <div className="flex items-center gap-3 rounded-control bg-fill1 px-4 py-3 text-[15px]">
        <StepNumber n={turn.step.index} done />
        <span className="min-w-0 flex-1 truncate font-semibold">{turn.step.title}</span>
        <span className="shrink-0 rounded-chip bg-card px-2.5 py-0.5 text-[13px] font-semibold text-ink2">
          {turn.done.label}
        </span>
      </div>
    );
  }
  if (turn.role === "step") {
    const { step } = turn;
    return (
      <article className="flex flex-col gap-4 rounded-card bg-card px-6 py-5 shadow-card">
        <div className="flex items-center gap-3">
          <StepNumber n={step.index} />
          <h2 className="text-[19px] leading-6 font-bold">{step.title}</h2>
        </div>
        <p className="text-[16px] leading-[26px]">{step.instruction}</p>
        {step.callout && (
          <p
            className={`flex gap-2 rounded-control px-3.5 py-2.5 text-[15px] leading-[22px] ${CALLOUT[step.callout.tone]}`}
          >
            {step.callout.tone === "info" ? (
              <Info aria-hidden size={18} className="mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle aria-hidden size={18} className="mt-0.5 shrink-0" />
            )}
            {step.callout.text}
          </p>
        )}
        {step.visual.kind === "photo" && (
          <p className="text-[13px] text-ink2">{step.visual.caption}</p>
        )}
        {turn.sources.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-ink2">Sources</span>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
              {turn.sources.map((src) => (
                <SourceCard key={src.n} source={src} />
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {step.outcomes.map((o) => (
            <button
              key={o.label}
              type="button"
              disabled={!latest}
              onClick={() => onOutcome(turn.id, o.kind, o.label)}
              className={`h-10 rounded-full px-4 text-[15px] font-semibold disabled:opacity-50 ${
                o.kind === "fixed"
                  ? "bg-act text-white hover:bg-act-press"
                  : "bg-fill1 hover:bg-fill2"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <AnswerFooter
          owners={ownersOf(turn.sources)}
          agent="troubleshooting"
          runId={runId}
          turnId={turn.id}
          question={step.title}
          answer={`${step.title}\n${step.instruction}`}
          copy
        />
      </article>
    );
  }
  return (
    <article className="flex flex-col gap-3 rounded-card bg-card px-6 py-5 shadow-card">
      <div className="flex items-center gap-2.5">
        {turn.result === "resolved" ? (
          <span className="flex size-7 items-center justify-center rounded-full bg-ok text-white">
            <Check aria-hidden size={16} strokeWidth={2.4} />
          </span>
        ) : (
          <span className="flex size-7 items-center justify-center rounded-full bg-fill2 text-ink2">
            <Info aria-hidden size={16} />
          </span>
        )}
        <h2 className="text-[19px] font-bold">
          {turn.result === "resolved" ? "Solved" : "No more steps in your documents"}
        </h2>
      </div>
      {turn.summary && <p className="text-[16px] leading-[26px]">{turn.summary}</p>}
      <AnswerFooter
        owners={ownersOf(turn.sources)}
        agent="troubleshooting"
        runId={runId}
        turnId={turn.id}
        question="Troubleshooting result"
        answer={turn.summary}
        copy
      />
    </article>
  );
}

function StepNumber({ n, done = false }: { n: number; done?: boolean }) {
  return (
    <span
      className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${
        done ? "bg-card text-ink2" : "bg-a-ts text-white"
      }`}
    >
      {n}
    </span>
  );
}
