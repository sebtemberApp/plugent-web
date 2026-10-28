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
 * ⚠️ THE PROMPT IS SEBTEMBER CHAT'S (`chat-prompt.ts`, copied verbatim), fed the way sebtember's
 * chat feeds it: the passages as `<retrieved_data>` under sebtember's own chunk headers, with the
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
import { generateText, type ModelMessage } from "ai";
import {
  buildCompleteFilesBlock,
  buildLanguageBlock,
  buildSourceQualityBlock,
  CONTINUITY_REMINDER,
  PLUGENT_SOURCES_RULE,
  renderChunkHeader,
  retrievedDocsHaveVersionedPair,
  SYSTEM_INSTRUCTION_GPT,
  VERSION_REMINDER,
} from "@/lib/agents/chat-prompt";
import { CLARIFY_TOOL, sanitizeClarify } from "@/lib/agents/clarify";
import { readUserContext } from "@/lib/agents/profile";
import { sanitizeForPrompt, stripInlineFilenames } from "@/lib/agents/sanitize";
import {
  type ChargeUsage,
  charge,
  getBalance,
  getKnowledgeCatalogues,
  type KnowledgePassage,
  type KnowledgeSearch,
  SebtemberApiError,
  searchKnowledge,
} from "@/lib/sebtember/products";
import { agentCharge, logCharge, searchCharge, type TurnCharge, usageOf } from "@/lib/usage";

/** A Vercel AI Gateway model id; sebtember's RFQ and gateway chat answer run on it. */
export const ASK_MODEL = process.env.PLUGENT_ASK_MODEL?.trim() || "openai/gpt-5.4-mini";
export const MAX_QUESTION_CHARS = 2000;
const MAX_PASSAGES = 12;
/** Sebtember chat's history window: the last 10 messages (5 questions and their answers). */
export const HISTORY_MESSAGES = 10;
/** Sebtember's `MAX_OWNED_SUBJECTS`. */
const MAX_OWNED_SUBJECTS = 20;
const MAX_ANSWER_TOKENS = 2000;
const ANSWER_TIMEOUT_MS = 45_000;

/**
 * The composer's mode, as in Sebtember chat. "deep" asks the model to reason longer
 * (OpenAI `reasoningEffort: "high"`, which the gateway forwards); its reasoning tokens
 * count as output, so it gets a larger output cap and a longer timeout, and costs more.
 */
export type AskMode = "standard" | "deep";
const DEEP_MAX_ANSWER_TOKENS = 8000;
const DEEP_ANSWER_TIMEOUT_MS = 75_000;

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

/** A `<`-tag inside stored text must not close the block it sits in. */
function fence(text: string): string {
  return text.replace(
    /<\/?(retrieved_data|user_persona|response_language|plugent_sources|catalogue_guidance|source_quality|complete_files)\b/gi,
    "‹$1",
  );
}

/** The model's view of one turn, assembled in sebtember's order (`buildDynamicSections`):
 *  persona, guidance + retrieved data, its strength, source quality, complete files, the
 *  version and continuity reminders, then the language last. */
export function buildAskPrompt(args: {
  question: string;
  search: Pick<
    KnowledgeSearch,
    "passages" | "retrievalStrength" | "catalogue_guidance" | "source_quality" | "whole_files"
  >;
  personaMd: string;
  /** The catalogues the user curates (their own), for the persona's second zone. */
  ownedSubjects?: string[];
  languageName: string | null;
  /** A follow-up in a chat that already has an answer: sebtember's continuity reminder. */
  continuing?: boolean;
}): string {
  const { passages } = args.search;
  const notes = fence(sanitizeForPrompt(args.personaMd.trim(), 8000));
  const owned = [
    ...new Set((args.ownedSubjects ?? []).map((n) => sanitizeForPrompt(n).trim()).filter(Boolean)),
  ].slice(0, MAX_OWNED_SUBJECTS);
  // Sebtember's `buildPersonaBlock`: what the user wrote, then what their account shows.
  const zones = [
    notes
      ? `## What the user told us about themselves — authoritative, follow this exactly\n${notes}`
      : "",
    owned.length > 0
      ? `## What their account shows — calibration only; the section above overrides this on any conflict\n- Curates their own knowledge base on: ${owned.join(", ")}`
      : "",
  ].filter(Boolean);
  const chunks = passages.map(
    (p, i) =>
      `Passage: ${i + 1}\n${renderChunkHeader({
        filename: p.file_name,
        catalogueName: p.catalogue_name,
        collectionName: p.collection_name,
        kindLabel: p.kind,
        isNote: p.is_note === true,
        page: p.page,
        section: p.section,
      })}\n\n${fence(p.text)}`,
  );
  const retrieved =
    passages.length > 0 ? `<retrieved_data>\n${chunks.join("\n\n===\n\n")}\n</retrieved_data>` : "";
  // Chat prepends the publishers' guidance to <retrieved_data> (sebtember's `retrieveContext`);
  // sebtember sends it already sanitised.
  const guidance = args.search.catalogue_guidance?.trim() ?? "";
  return [
    zones.length > 0 ? `<user_persona>\n${zones.join("\n\n")}\n</user_persona>` : "",
    guidance && retrieved ? `${guidance}\n\n${retrieved}` : retrieved,
    `<retrieval_strength>${args.search.retrievalStrength}</retrieval_strength>`,
    buildSourceQualityBlock(
      (args.search.source_quality ?? []).map((n) => ({
        filename: sanitizeForPrompt(n.filename),
        issues: n.issues.map((i) => sanitizeForPrompt(i)),
      })),
    ),
    buildCompleteFilesBlock((args.search.whole_files ?? []).map((f) => sanitizeForPrompt(f))),
    passages.length > 0 &&
    retrievedDocsHaveVersionedPair(passages.map((p) => ({ filename: p.file_name })))
      ? VERSION_REMINDER
      : "",
    args.continuing ? CONTINUITY_REMINDER : "",
    PLUGENT_SOURCES_RULE,
    buildLanguageBlock(args.languageName),
    args.question,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The reply without its machine `SOURCES:` line, and the passage numbers that line named
 *  (null when the model left it out). */
export function splitSources(text: string): { answer: string; used: number[] | null } {
  const lines = text.trimEnd().split("\n");
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
    const m = /^\s*\**SOURCES:?\**:?\s*(.*)$/i.exec(lines[i] ?? "");
    if (!m) continue;
    const used = [...(m[1] ?? "").matchAll(/\d+/g)].map((d) => Number(d[0]));
    lines.splice(i, 1);
    return { answer: lines.join("\n").trim(), used };
  }
  return { answer: text.trim(), used: null };
}

/** What sebtember says about one granted catalogue: Library or not (Step 1176), and whose
 *  it is (Step 1177; `undefined` from an older sebtember). */
export type CatalogueInfo = { library: boolean; owner?: { name: string | null } | null };

/** Whose content a source is, for the answer card's "Source:" row: `null` = the user's own.
 *  Without sebtember's owner (an older sebtember) a Library source is "Library". */
export function ownerLabel(info: CatalogueInfo | undefined): string | null {
  if (!info) return null;
  if (info.owner === undefined) return info.library ? "Library" : null;
  if (info.owner === null) return null;
  return info.owner.name ?? "Another Sebtember user";
}

/** The source cards: the passages the answer used (`used`, from its SOURCES line; an older
 *  answer's [n] marks otherwise; every passage when it named none), ONE card per file with its
 *  pages together, numbered in order. `catalogues` is what sebtember says about each granted
 *  catalogue. */
export function citedSources(
  answer: string,
  passages: KnowledgePassage[],
  catalogues: ReadonlyMap<string, CatalogueInfo> = new Map(),
  used: number[] | null = null,
): AskSource[] {
  const marked = [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const picked = new Set(used ?? (marked.length > 0 ? marked : passages.map((_, i) => i + 1)));
  const byFile = new Map<string, AskSource>();
  passages.forEach((p, i) => {
    if (!picked.has(i + 1)) return;
    const key = `${p.catalogue_id}/${p.file_name}`;
    const seen = byFile.get(key);
    if (seen) {
      if (p.page && !seen.page?.split(", ").includes(p.page)) {
        seen.page = seen.page ? `${seen.page}, ${p.page}` : p.page;
      }
      return;
    }
    byFile.set(key, {
      n: byFile.size + 1,
      fileName: p.file_name,
      catalogueName: p.catalogue_name,
      page: p.page,
      library: catalogues.get(p.catalogue_id)?.library ?? false,
      owner: ownerLabel(catalogues.get(p.catalogue_id)),
    });
  });
  return [...byFile.values()];
}

export interface AskSource {
  n: number;
  fileName: string;
  catalogueName: string | null;
  page: string | null;
  /** From another user's published catalogue (Library), not the user's own. */
  library: boolean;
  /** Whose content it is: `null` = the user's own, else the owner's name. */
  owner: string | null;
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
    }
  | { kind: "not_covered"; tokens: number; balanceAfter: number | null; charges?: TurnCharge[] };

/** One earlier message of the same chat, oldest first (the route reads them from the run). */
export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export class AskRefused extends Error {
  constructor(readonly code: "low_balance" | "not_connected") {
    super(code);
  }
}

export async function runAsk(
  uid: string,
  question: string,
  mode: AskMode = "standard",
  history: HistoryMessage[] = [],
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
    };
  }

  const { languageName, personaMd } = await userContext;
  // Sebtember's gateway turn: the earlier messages as they were, then the new question with
  // the per-turn blocks spliced in front of it.
  const messages: ModelMessage[] = [
    ...history.map((m) => ({ role: m.role, content: sanitizeForPrompt(m.content) })),
    {
      role: "user",
      content: buildAskPrompt({
        question: sanitizeForPrompt(question),
        search,
        personaMd,
        ownedSubjects: await ownedSubjects,
        languageName,
        continuing: history.some((m) => m.role === "assistant"),
      }),
    },
  ];
  const result = await generateText({
    model: ASK_MODEL,
    instructions: SYSTEM_INSTRUCTION_GPT,
    messages,
    // Sebtember's clarify tool: calling it ends the turn with a question and chips.
    tools: { ask_clarification: CLARIFY_TOOL },
    ...(mode === "deep"
      ? {
          maxOutputTokens: DEEP_MAX_ANSWER_TOKENS,
          timeout: DEEP_ANSWER_TIMEOUT_MS,
          providerOptions: { openai: { reasoningEffort: "high" } },
        }
      : { maxOutputTokens: MAX_ANSWER_TOKENS, timeout: ANSWER_TIMEOUT_MS }),
  });

  const answerTokens = billedAnswerTokens(result.totalUsage);
  const usage = [usageOf(ASK_MODEL, result.totalUsage)];
  logCharge("chat", uid, `${runId}-answer`, answerTokens, usage);
  let balanceAfter = search.balanceAfter;
  let charged = true;
  if (answerTokens > 0) {
    const line = { id: `${runId}-answer`, tokens: answerTokens, operation: "ask_answer", usage };
    // The line is idempotent on sebtember, so one retry can never charge twice.
    const res = await charge(uid, wallet.source, [line]).catch(() =>
      charge(uid, wallet.source, [line]).catch((err) => {
        console.error(`[ask] charge failed uid=${uid} run=${runId} tokens=${answerTokens}`, err);
        return null;
      }),
    );
    if (res) balanceAfter = res.balanceAfter;
    else charged = false;
  }

  const call = result.toolCalls.find((c) => c.toolName === "ask_clarification");
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
    };
  }

  const split = splitSources(result.text);
  // Sebtember's backstop: a file name cited in the prose goes; the cards carry it.
  const answer = stripInlineFilenames(split.answer);
  const used = split.used;
  return {
    kind: "answer",
    answer,
    sources: citedSources(answer, search.passages, await catalogueInfo, used),
    tokens: searchTokens + answerTokens,
    balanceAfter,
    charged,
    usage,
    charges: [
      ...searchCharge(runId, search),
      ...agentCharge(`${runId}-answer`, "Answer", answerTokens, usage, charged),
    ],
  };
}
