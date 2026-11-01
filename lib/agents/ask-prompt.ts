/**
 * Chat's answer call, pure: what the model is sent and how its reply is read. `runAsk`
 * (`ask.ts`) wraps it with the wallet, the search, the charge and the save; the behaviour eval
 * (`lib/agents/eval/chat-behavior-eval.ts`) calls these same functions, so a prompt change is
 * tested exactly as it ships. No `server-only` here: the eval imports it from a script.
 */
import type { ModelMessage } from "ai";
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
import { CLARIFY_TOOL } from "@/lib/agents/clarify";
import { sanitizeForPrompt, stripInlineFilenames } from "@/lib/agents/sanitize";
import type { KnowledgePassage, KnowledgeSearch } from "@/lib/sebtember/products";

/** A Vercel AI Gateway model id; sebtember's RFQ and gateway chat answer run on it. */
export const ASK_MODEL = process.env.PLUGENT_ASK_MODEL?.trim() || "openai/gpt-5.4-mini";
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

/** One earlier message of the same chat, oldest first (the route reads them from the run). */
export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** The model, the system prompt, the clarify tool and the limits of one answer call. */
export function askCallOptions(mode: AskMode) {
  return {
    model: ASK_MODEL,
    instructions: SYSTEM_INSTRUCTION_GPT,
    // Sebtember's clarify tool: calling it ends the turn with a question and chips.
    tools: { ask_clarification: CLARIFY_TOOL },
    ...(mode === "deep"
      ? {
          maxOutputTokens: DEEP_MAX_ANSWER_TOKENS,
          timeout: DEEP_ANSWER_TIMEOUT_MS,
          providerOptions: { openai: { reasoningEffort: "high" } },
        }
      : { maxOutputTokens: MAX_ANSWER_TOKENS, timeout: ANSWER_TIMEOUT_MS }),
  };
}

/** A `<`-tag inside stored text must not close the block it sits in. */
function fence(text: string): string {
  return text.replace(
    /<\/?(retrieved_data|user_persona|response_language|plugent_sources|catalogue_guidance|source_quality|complete_files)\b/gi,
    "‹$1",
  );
}

export type AskSearch = Pick<
  KnowledgeSearch,
  "passages" | "retrievalStrength" | "catalogue_guidance" | "source_quality" | "whole_files"
>;

/** The model's view of one turn, assembled in sebtember's order (`buildDynamicSections`):
 *  persona, guidance + retrieved data, its strength, source quality, complete files, the
 *  version and continuity reminders, then the language last. */
export function buildAskPrompt(args: {
  question: string;
  search: AskSearch;
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

/** Sebtember's gateway turn: the earlier messages as they were, then the new question with
 *  the per-turn blocks spliced in front of it. */
export function askMessages(args: {
  question: string;
  history: HistoryMessage[];
  search: AskSearch;
  personaMd: string;
  ownedSubjects?: string[];
  languageName: string | null;
}): ModelMessage[] {
  return [
    ...args.history.map((m) => ({ role: m.role, content: sanitizeForPrompt(m.content) })),
    {
      role: "user",
      content: buildAskPrompt({
        question: sanitizeForPrompt(args.question),
        search: args.search,
        personaMd: args.personaMd,
        ownedSubjects: args.ownedSubjects,
        languageName: args.languageName,
        continuing: args.history.some((m) => m.role === "assistant"),
      }),
    },
  ];
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

/** What the user is shown of a finished reply, and the passages its SOURCES line named.
 *  Sebtember's backstop: a file name cited in the prose goes; the cards carry it. */
export function readAnswer(text: string): { answer: string; used: number[] | null } {
  const split = splitSources(text);
  return { answer: stripInlineFilenames(split.answer), used: split.used };
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
