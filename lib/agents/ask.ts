/**
 * Ask — Plugent's first agent (milestone 3): answers a question from the Sebtember
 * catalogues the user granted Plugent, with numbered sources, and charges the user's
 * Sebtember wallet.
 *
 * One run:
 *   1. `getBalance` — gate on the floor and keep the returned `source` for every charge;
 *   2. `searchKnowledge` — sebtember searches the GRANTED catalogues only and charges its
 *      own search (line `{runId}-search`);
 *   3. nothing found → say so, no model call;
 *   4. the answer model, from the passages only;
 *   5. `charge` the model work as line `{runId}-answer` to the SAME source.
 *
 * ⚠️ THE PROMPT IS PLUGENT'S OWN (`chat-prompt.ts`; it began as sebtember chat's). `ask-prompt.ts`
 * builds the call, the same pure functions the behaviour eval runs (`pnpm eval:chat-behavior`),
 * and feeds it the way sebtember's chat did: the passages as `<retrieved_data>` under sebtember's own chunk headers, with the
 * publishers' `<catalogue_guidance>` before them, the search's `<retrieval_strength>`,
 * `<source_quality>` and `<complete_files>`, the user's notes as `<user_persona>`, the
 * dated-version reminder, and `<response_language>` from the user's Sebtember language. The
 * search gets the chat's last 10 messages, so sebtember rewrites a follow-up as chat does. So a question reads
 * the same here as in Sebtember chat.
 * ⚠️ PASSAGES ARE DATA. They are the user's stored documents, inside <retrieved_data>, never
 * followed as instructions.
 * ⚠️ PRICED LIKE SEBTEMBER'S OWN GATEWAY ANSWER. `billedAnswerTokens` applies sebtember's
 * `MINI_ANSWER_BILLING_DISCOUNTS` (Step 552: input ÷6, reasoning and text output ×2) to
 * the gateway's usage, so a question costs the same here as in Sebtember chat.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { streamText } from "ai";
import {
  ASK_MODEL,
  type AskMode,
  type AskSource,
  askCallOptions,
  askMessages,
  type CatalogueInfo,
  citedSources,
  type HistoryMessage,
  readAnswer,
} from "@/lib/agents/ask-prompt";
import { CHAT_PROMPT_VERSION, SYSTEM_INSTRUCTION_GPT } from "@/lib/agents/chat-prompt";
import { sanitizeClarify } from "@/lib/agents/clarify";
import { readUserContext } from "@/lib/agents/profile";
import {
  type ChargeUsage,
  getBalance,
  getKnowledgeCatalogues,
  type KnowledgeSearch,
  SebtemberApiError,
  searchKnowledge,
} from "@/lib/sebtember/products";
import { reportRunAfter, thinGap } from "@/lib/sebtember/report";
import { chargeOrKeep } from "@/lib/unpaid";
import {
  agentCharge,
  logCharge,
  searchCharge,
  type TurnCharge,
  unpaidCharge,
  usageOf,
} from "@/lib/usage";

export {
  ASK_MODEL,
  type AskMode,
  type AskSource,
  type CatalogueInfo,
  type HistoryMessage,
  ownerLabel,
} from "@/lib/agents/ask-prompt";

export const MAX_QUESTION_CHARS = 2000;
const MAX_PASSAGES = 12;
/** Sebtember chat's history window: the last 10 messages (5 questions and their answers). */
export const HISTORY_MESSAGES = 10;

/** Divisors on the gateway's usage (billed = raw / factor; < 1 marks up). */
const DISCOUNTS = { input: 6, reasoning: 0.5, output: 0.5 };

export interface AskUsage {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number; textTokens?: number };
}

/** Sebtember tokens for one answer, from the gateway's usage. */
export function billedAnswerTokens(usage: AskUsage): number {
  const cached = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const input = Math.max((usage.inputTokens ?? 0) - cached, 0);
  const reasoning = usage.outputTokenDetails?.reasoningTokens ?? 0;
  const text =
    usage.outputTokenDetails?.textTokens ?? Math.max((usage.outputTokens ?? 0) - reasoning, 0);
  return (
    Math.ceil(input / DISCOUNTS.input) +
    Math.ceil(reasoning / DISCOUNTS.reasoning) +
    Math.ceil(text / DISCOUNTS.output)
  );
}

/**
 * What the model saw and how it answered, for the review that improves Chat (the self-improvement
 * loop): the search sebtember returned (the passages verbatim, their strength, the complete files,
 * the quality notes), the prompt version, model and mode, and the passages the answer named. Saved
 * BESIDE the turn (`traces/{turnId}`, `lib/runs.ts`) with a 30-day TTL, never on it, and never sent
 * to the browser: the passages are the user's documents.
 */
export interface AskTrace {
  promptVersion: string;
  model: string;
  mode: AskMode;
  /** Earlier messages the model continued (0 = a first question). */
  historyLength: number;
  retrievalStrength: string;
  passages: Array<{
    catalogue_id: string;
    catalogue_name: string | null;
    file_name: string;
    page: string | null;
    section: string | null;
    collection_name: string | null;
    kind: string | null;
    is_note: boolean;
    text: string;
  }>;
  wholeFiles: string[];
  sourceQuality: { filename: string; issues: string[] }[];
  /** The publishers' guidance was prepended to the passages. */
  guidance: boolean;
  /** The passage numbers the answer's SOURCES line named (null: it named none). */
  used: number[] | null;
  /** The model asked back instead of answering. */
  clarify: boolean;
  stopped: boolean;
}

/**
 * A trace is written in the turn's batch, so it must stay far under Firestore's 1 MiB document limit
 * or the paid answer is not saved: each passage is kept to `TRACE_PASSAGE_CHARS`, and the whole set
 * to `TRACE_TOTAL_CHARS` (the judge reads 1500 of each anyway).
 */
const TRACE_PASSAGE_CHARS = 20_000;
const TRACE_TOTAL_CHARS = 250_000; // ≤ 750 KB even at 3 bytes a character

function traceOf(
  search: KnowledgeSearch,
  mode: AskMode,
  historyLength: number,
  outcome: { used: number[] | null; clarify: boolean; stopped: boolean },
): AskTrace {
  let budget = TRACE_TOTAL_CHARS;
  return {
    promptVersion: CHAT_PROMPT_VERSION,
    model: ASK_MODEL,
    mode,
    historyLength,
    retrievalStrength: search.retrievalStrength,
    passages: search.passages.map((p) => ({
      catalogue_id: p.catalogue_id,
      catalogue_name: p.catalogue_name,
      file_name: p.file_name,
      page: p.page,
      section: p.section ?? null,
      collection_name: p.collection_name ?? null,
      kind: p.kind ?? null,
      is_note: p.is_note === true,
      text: (() => {
        const text = p.text.slice(0, Math.max(0, Math.min(TRACE_PASSAGE_CHARS, budget)));
        budget -= text.length;
        return text;
      })(),
    })),
    wholeFiles: search.whole_files ?? [],
    sourceQuality: search.source_quality ?? [],
    guidance: Boolean(search.catalogue_guidance?.trim()),
    ...outcome,
  };
}

export type AskResult =
  | {
      kind: "answer";
      answer: string;
      sources: AskSource[];
      tokens: number;
      balanceAfter: number | null;
      /** false when the answer's charge failed: the answer is still shown, and logged. */
      charged: boolean;
      /** The model calls behind this answer, raw counts; kept on the turn. */
      usage?: ChargeUsage[];
      /** What the turn cost, line by line (the Usage page). */
      charges?: TurnCharge[];
      /** Chat asked a clarifying question instead (`answer` is the question): its chips. */
      clarify?: { question: string; options: string[] };
      /** The user pressed Stop: `answer` is what was written until then. */
      stopped?: boolean;
      /** Lines whose charge failed and were kept for a retry: linked to the saved turn. */
      unpaid?: TurnCharge[];
      /** Saved beside the turn, never sent to the browser (`AskTrace`). */
      trace?: AskTrace;
    }
  | {
      kind: "not_covered";
      tokens: number;
      balanceAfter: number | null;
      charges?: TurnCharge[];
      unpaid?: TurnCharge[];
      trace?: AskTrace;
    };

export class AskRefused extends Error {
  constructor(readonly code: "low_balance" | "not_connected") {
    super(code);
  }
}

/** What the route listens with while an answer streams (audit F5). */
export interface AskStream {
  /** Each piece of answer text as the model writes it. */
  onDelta?: (text: string) => void;
  /** Aborted when the user presses Stop: the model stops, and what it wrote is the answer. */
  stop?: AbortSignal;
}

/** About four characters a token: the estimate a stopped answer is charged by. */
const CHARS_PER_TOKEN = 4;

export async function runAsk(
  uid: string,
  question: string,
  mode: AskMode = "standard",
  history: HistoryMessage[] = [],
  stream: AskStream = {},
): Promise<AskResult> {
  const wallet = await getBalance(uid);
  if (wallet.balance < wallet.minimum) throw new AskRefused("low_balance");
  const runId = randomUUID();

  // Which granted catalogues are Library ones and whose each is, for the source cards and
  // the "Source:" row. Read beside the search; a failure only means every source shows as
  // the user's own.
  const catalogueInfo = getKnowledgeCatalogues(uid)
    .then(
      ({ catalogues }) =>
        new Map<string, CatalogueInfo>(
          catalogues.map((c) => [c.id, { library: c.library === true, owner: c.owner }]),
        ),
    )
    .catch(() => new Map<string, CatalogueInfo>());

  // The user's Sebtember language and notes, read beside the search (fail-open).
  const userContext = readUserContext(uid);
  // The catalogues the user curates: their own ones Plugent reads (the persona's second zone).
  const ownedSubjects = getKnowledgeCatalogues(uid)
    .then(({ catalogues }) =>
      catalogues.filter((c) => c.owner === null && !c.library && !c.paused).map((c) => c.name),
    )
    .catch(() => [] as string[]);

  let search: Awaited<ReturnType<typeof searchKnowledge>>;
  try {
    search = await searchKnowledge(uid, wallet.source, question, runId, MAX_PASSAGES, history);
  } catch (err) {
    if (err instanceof SebtemberApiError && err.code === "not_connected") {
      throw new AskRefused("not_connected");
    }
    throw err;
  }
  const searchTokens = search.charged.tokens;
  if (search.passages.length === 0) {
    return {
      kind: "not_covered",
      tokens: searchTokens,
      balanceAfter: search.balanceAfter,
      charges: searchCharge(runId, search),
      trace: traceOf(search, mode, history.length, { used: null, clarify: false, stopped: false }),
    };
  }

  const { languageName, personaMd } = await userContext;
  const messages = askMessages({
    question,
    history,
    search,
    personaMd,
    ownedSubjects: await ownedSubjects,
    languageName,
  });
  // Stopped while the search ran: the model is never called, so only the search is paid for.
  if (stream.stop?.aborted) {
    return {
      kind: "answer",
      answer: "",
      sources: [],
      tokens: searchTokens,
      balanceAfter: search.balanceAfter,
      charged: true,
      stopped: true,
      charges: searchCharge(runId, search),
      trace: traceOf(search, mode, history.length, { used: null, clarify: false, stopped: true }),
    };
  }

  // Streamed (audit F5): the text reaches the user as it is written. A Stop aborts the model.
  const model = new AbortController();
  const onStop = () => model.abort("stopped");
  if (stream.stop?.aborted) onStop();
  stream.stop?.addEventListener("abort", onStop, { once: true });
  const result = streamText({
    ...askCallOptions(mode),
    messages,
    abortSignal: model.signal,
  });
  let text = "";
  let totalUsage: AskUsage | null = null;
  const toolCalls: { toolName: string; input: unknown }[] = [];
  try {
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        text += part.text;
        stream.onDelta?.(part.text);
      } else if (part.type === "tool-call") {
        toolCalls.push({ toolName: part.toolName, input: part.input });
      } else if (part.type === "finish") {
        totalUsage = part.totalUsage;
      } else if (part.type === "error") {
        throw part.error;
      }
    }
  } catch (err) {
    // A Stop ends the stream however the SDK reports it; anything else is a failed answer.
    if (!model.signal.aborted || model.signal.reason !== "stopped") throw err;
  } finally {
    stream.stop?.removeEventListener("abort", onStop);
  }
  const stopped = model.signal.aborted && model.signal.reason === "stopped";
  if (!totalUsage && !stopped) throw new Error("ask: the stream ended without usage");

  // ⚠️ A STOPPED ANSWER IS CHARGED BY AN ESTIMATE: the provider reports no usage for a call cut
  // short, so its prompt and its written text are counted at CHARS_PER_TOKEN (its reasoning is
  // not counted at all). Never free: stopping just before the end must not make an answer free.
  // The fixed system instruction is the prefix a provider caches, so it is counted as cached, as
  // a finished answer's usage would report it; a stopped answer then never costs more than the
  // same answer finished (audit N3).
  const cachedPrefix = Math.ceil(SYSTEM_INSTRUCTION_GPT.length / CHARS_PER_TOKEN);
  const usageNow: AskUsage = totalUsage ?? {
    inputTokens:
      cachedPrefix +
      Math.ceil(
        messages.reduce(
          (sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0),
          0,
        ) / CHARS_PER_TOKEN,
      ),
    inputTokenDetails: { cacheReadTokens: cachedPrefix },
    outputTokens: Math.ceil(text.length / CHARS_PER_TOKEN),
  };
  const answerTokens = billedAnswerTokens(usageNow);
  const usage = [usageOf(ASK_MODEL, usageNow)];
  logCharge("chat", uid, `${runId}-answer`, answerTokens, usage);
  let balanceAfter = search.balanceAfter;
  let charged = true;
  if (answerTokens > 0) {
    const line = {
      id: `${runId}-answer`,
      tokens: answerTokens,
      operation: stopped ? "ask_answer_stopped" : "ask_answer",
      usage,
    };
    // Kept for a retry when both attempts fail (`lib/unpaid.ts`); idempotent per line id.
    const res = await chargeOrKeep("ask", uid, wallet.source, line);
    if (res) balanceAfter = res.balanceAfter;
    else charged = false;
  }

  const call = toolCalls.find((c) => c.toolName === "ask_clarification");
  const clarify = call ? sanitizeClarify(call.input) : null;
  if (clarify) {
    return {
      kind: "answer",
      answer: clarify.question,
      sources: [],
      tokens: searchTokens + answerTokens,
      balanceAfter,
      charged,
      usage,
      clarify,
      charges: [
        ...searchCharge(runId, search),
        ...agentCharge(`${runId}-answer`, "Question back", answerTokens, usage, charged),
      ],
      unpaid: unpaidCharge(`${runId}-answer`, "Question back", answerTokens, usage, charged),
      trace: traceOf(search, mode, history.length, { used: null, clarify: true, stopped: false }),
    };
  }

  // Paid for: the documents' owners get their credit, and a thin search a gap card.
  if (text.trim().length > 0) {
    reportRunAfter(uid, {
      function: "chat",
      requestId: runId,
      passages: search.passages,
      retrievalStrength: search.retrievalStrength,
      gap: thinGap(search.retrievalStrength, question),
    });
  }

  const read = readAnswer(text);
  const answer = read.answer;
  // A stopped answer never reached its SOURCES line: it cites nothing rather than every passage.
  const used = stopped ? (read.used ?? []) : read.used;
  return {
    kind: "answer",
    answer,
    sources: citedSources(answer, search.passages, await catalogueInfo, used),
    tokens: searchTokens + answerTokens,
    balanceAfter,
    charged,
    usage,
    ...(stopped ? { stopped: true } : {}),
    charges: [
      ...searchCharge(runId, search),
      ...agentCharge(
        `${runId}-answer`,
        stopped ? "Answer (stopped)" : "Answer",
        answerTokens,
        usage,
        charged,
      ),
    ],
    unpaid: unpaidCharge(
      `${runId}-answer`,
      stopped ? "Answer (stopped)" : "Answer",
      answerTokens,
      usage,
      charged,
    ),
    trace: traceOf(search, mode, history.length, { used, clarify: false, stopped }),
  };
}
