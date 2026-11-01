/**
 * Chat's BEHAVIORAL regression gate — ported from sebtember's `lib/chat/eval/behavior-eval.ts`
 * (Step 556) when Chat's prompt became Plugent's own (2026-11-01).
 *
 * Each case is a behavior a prompt edit once fixed (over-refusal, over-promising offers, missing
 * synthesis, dropped companion specs, raw-asterisk dimensions, filename leaks, subject match,
 * Lithuanian terminology, …), baked as the SEARCH RESULT sebtember would return (passages with
 * their chunk headers, retrieval strength, complete files) plus the user's notes and language.
 * The turn is built and read by `ask-prompt.ts`, the code `runAsk` ships, so the model sees
 * exactly what production sends: Plugent's prompt, the clarify tool, the mode's limits.
 *
 * Checks, hybrid as in sebtember:
 *   - `assert`: a named deterministic predicate over the answer the user is SHOWN (after the
 *     SOURCES line is split off and inline file names are stripped).
 *   - `judge`: a yes/no rubric graded by a fixed strong judge (`anthropic/claude-sonnet-5`, never
 *     the model under test).
 *   Every case also gets Plugent's own: it answered (no clarifying question) unless `clarify_ok`,
 *   it ended with a SOURCES line naming real passages, and no passage marks leaked into the prose.
 *
 * Retrieval is held CONSTANT (no sebtember, no Firebase, no wallet): only the AI Gateway is
 * called. Auth: AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN from `vercel env pull`) in .env.local.
 *
 * Usage:
 *   pnpm eval:chat-behavior                          # SMOKE: case shapes + prompts build, no calls
 *   pnpm eval:chat-behavior -- --run                 # the paid suite, standard mode
 *   pnpm eval:chat-behavior -- --run --mode=all      # standard and deep
 *   pnpm eval:chat-behavior -- --run --case=synthesis-cascade
 *   pnpm eval:chat-behavior -- --run --model=openai/gpt-5.4-mini
 *   pnpm eval:chat-behavior -- --run --baseline=eval-results/chat-behavior_<stamp>.json
 *   pnpm eval:chat-behavior -- --dump-prompt --case=no-filename-in-prose
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateText } from "ai";
import { config as dotenvConfig } from "dotenv";
import {
  type AskMode,
  type AskSearch,
  askCallOptions,
  askMessages,
  type HistoryMessage,
  readAnswer,
} from "@/lib/agents/ask-prompt";
import { CHAT_PROMPT_VERSION, renderChunkHeader } from "@/lib/agents/chat-prompt";
import { sanitizeClarify } from "@/lib/agents/clarify";
import type { KnowledgePassage } from "@/lib/sebtember/products";
import casesFile from "./chat-behavior-cases.json";

dotenvConfig({ path: ".env.local" });
dotenvConfig();

/** The judge: a different family from the answer model, fixed so runs stay comparable. */
const JUDGE_MODEL = process.env.CHAT_EVAL_JUDGE_MODEL?.trim() || "anthropic/claude-sonnet-5";

/* --------------------------------------------------------- deterministic asserts
 * Each returns true when the answer SATISFIES the named behavior (sebtember's, unchanged). Kept
 * tight so a legitimate answer never false-fails; the semantic behaviors go to the judge. */
const EMOJI_PALETTE = /[\u{1F4CB}\u{26A0}\u{1F4A1}\u{1F527}\u{2705}\u{1F4E6}\u{1F4C4}]/u;
const ANY_EMOJI = /\p{Extended_Pictographic}/u;
const FILE_EXT = /\.(pdf|docx?|xlsx?|csv|md|txt|pptx?)\b/i;
const SOURCE_PREFIX = /(^|\n)\s*(Document|Source|From)\s*:/i;
const DIMS_WITH_X = /\d[\d.,]*\s*[×xX]\s*\d[\d.,]*\s*[×xX]\s*\d/;
const DIMS_RAW_STAR = /\d[\d.,]*\s*\*\s*\d[\d.,]*\s*\*\s*\d/;
const MD_HEADING = /(^|\n)#{1,3}\s/;
/** A passage number, a [n] mark or the SOURCES line itself, left in what the user sees. */
const PASSAGE_MARK = /\bPassage\s*:?\s*\d|\[\d+\]|(^|\n)\s*\**SOURCES\b/i;

const ASSERTIONS: Record<string, (a: string) => boolean> = {
  // 546 — dimensions with × / x, never a raw asterisk that CommonMark eats as italics.
  dims_use_multiply_sign: (a) => DIMS_WITH_X.test(a),
  no_raw_asterisk_dims: (a) => !DIMS_RAW_STAR.test(a),
  // §6 — no filename / extension / "Document:" / "Source:" prefix in the prose.
  no_filename_in_prose: (a) => !FILE_EXT.test(a) && !SOURCE_PREFIX.test(a),
  // 771 — no transliterated English term ("kapacitetas" is not a Lithuanian word).
  no_lt_transliteration: (a) => !/kapacitet/i.test(a),
  // 541 — a substantive answer carries a functional-palette emoji.
  has_palette_emoji: (a) => EMOJI_PALETTE.test(a),
  // §5 — a genuine one-liner (thin retrieval) stays clean: no emoji, no heading.
  no_emoji: (a) => !ANY_EMOJI.test(a),
  no_markdown_heading: (a) => !MD_HEADING.test(a),
  // §5 ONE-SENTENCE — at most ~2 sentence-enders.
  at_most_two_sentences: (a) =>
    a
      .trim()
      .split(/[.!?](?:\s|$)/u)
      .filter((s) => s.trim().length > 3).length <= 2,
};

/* ------------------------------------------------------------------ case types */

type Check = { assert: string } | { judge: string; expect: "yes" | "no" };

interface CasePassage {
  file_name: string;
  catalogue_name: string | null;
  page?: string;
  section?: string;
  collection_name?: string;
  /** Chat's kind label, as sebtember's search sends it. */
  kind?: string;
  is_note?: boolean;
  text: string;
}

interface BehaviorCase {
  id: string;
  category: string;
  /** Where the behavior was introduced ("seb 546" = sebtember Step 546). */
  since?: string;
  note?: string;
  retrieval_strength: "rich" | "normal" | "thin" | "empty";
  passages: CasePassage[];
  /** Files sebtember marked complete (`<complete_files>`). */
  whole_files?: string[];
  catalogue_guidance?: string;
  /** The user's own notes (`<user_persona>`'s authoritative zone). */
  persona_md?: string;
  /** The user's Sebtember language name ("Lithuanian"), as `readUserContext` returns it. */
  language?: string;
  /** Earlier messages of the same chat, oldest first. */
  history?: HistoryMessage[];
  question: string;
  /** A clarifying question is an acceptable reply (otherwise it fails `answered`). */
  clarify_ok?: boolean;
  /** Runs and reports, but never fails the gate (behaviors at the model's reliability edge). */
  informational?: boolean;
  checks: Check[];
}

interface CheckResult {
  label: string;
  kind: "assert" | "judge" | "plugent";
  pass: boolean;
  detail?: string;
}

interface CaseResult {
  id: string;
  mode: AskMode;
  category: string;
  since?: string;
  informational?: boolean;
  pass: boolean;
  latencyMs: number;
  checks: CheckResult[];
  /** What the user is shown (or the clarifying question). */
  answer: string;
  clarify?: { question: string; options: string[] };
  used: number[] | null;
  error?: string;
}

/* ----------------------------------------------------------------------- flags */

function parseFlag(name: string): string | null {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
}
const DO_RUN = process.argv.includes("--run");
const DUMP_PROMPT = process.argv.includes("--dump-prompt");
const CASE_FILTER = parseFlag("case");
const MODEL_OVERRIDE = parseFlag("model");
const BASELINE = parseFlag("baseline");
const MODE_FLAG = parseFlag("mode") ?? "standard";
const MODES: AskMode[] =
  MODE_FLAG === "all" ? ["standard", "deep"] : MODE_FLAG === "deep" ? ["deep"] : ["standard"];
const CONCURRENCY = Math.max(1, Number(parseFlag("concurrency") ?? 4) || 4);

const cases = (casesFile as BehaviorCase[]).filter((c) => !CASE_FILTER || c.id === CASE_FILTER);

/* --------------------------------------------------------------------- helpers */

/** The case as sebtember's search would have returned it. */
function searchOf(c: BehaviorCase): AskSearch {
  const passages: KnowledgePassage[] = c.passages.map((p, i) => ({
    document_id: `${c.id}-${i + 1}`,
    file_id: null,
    file_name: p.file_name,
    catalogue_id: (p.catalogue_name ?? "catalogue").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    catalogue_name: p.catalogue_name,
    page: p.page ?? null,
    collection_name: p.collection_name ?? null,
    section: p.section ?? null,
    kind: p.kind ?? null,
    is_note: p.is_note === true,
    text: p.text,
  }));
  return {
    passages,
    retrievalStrength: c.retrieval_strength,
    catalogue_guidance: c.catalogue_guidance,
    whole_files: c.whole_files,
  } as AskSearch;
}

function messagesOf(c: BehaviorCase) {
  return askMessages({
    question: c.question,
    history: c.history ?? [],
    search: searchOf(c),
    personaMd: c.persona_md ?? "",
    languageName: c.language ?? null,
  });
}

function callOptions(mode: AskMode) {
  const options = askCallOptions(mode);
  return MODEL_OVERRIDE ? { ...options, model: MODEL_OVERRIDE } : options;
}

/** What the judge reads: the passages under their production headers, and the user's notes. */
function contextOf(c: BehaviorCase): string {
  const passages = searchOf(c).passages.map(
    (p) =>
      `${renderChunkHeader({
        filename: p.file_name,
        catalogueName: p.catalogue_name,
        collectionName: p.collection_name,
        kindLabel: p.kind,
        isNote: p.is_note === true,
        page: p.page,
        section: p.section,
      })}\n${p.text}`,
  );
  const complete = c.whole_files?.length
    ? `\n\n(Marked COMPLETE — the entire stored content of: ${c.whole_files.join(", ")})`
    : "";
  const notes = c.persona_md ? `\n\nTHE USER'S OWN NOTES ABOUT THEMSELVES:\n${c.persona_md}` : "";
  return `${passages.join("\n\n")}${complete}${notes}`;
}

function judgePrompt(c: BehaviorCase, answer: string, check: string): string {
  return `You are grading whether an AI assistant's ANSWER satisfies ONE specific behavioral CHECK. Judge ONLY the check.

CHECK: ${check}

Respond with ONLY this JSON, no prose: {"verdict":"yes"|"no","reason":"one short sentence"}

USER QUESTION:
${c.question}

CONTEXT the assistant was given (its ONLY source of specific facts):
${contextOf(c).slice(0, 8000)}

ASSISTANT ANSWER:
${answer.slice(0, 6000)}`;
}

async function runJudge(
  c: BehaviorCase,
  answer: string,
  check: string,
): Promise<{ verdict: "yes" | "no" | "?"; reason: string }> {
  try {
    const res = await generateText({
      model: JUDGE_MODEL,
      prompt: judgePrompt(c, answer, check),
      maxOutputTokens: 300,
      maxRetries: 4,
    });
    const raw = res.text ?? "";
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s < 0 || e <= s) return { verdict: "?", reason: "unparseable judge output" };
    const p = JSON.parse(raw.slice(s, e + 1)) as { verdict?: string; reason?: string };
    const v = String(p.verdict ?? "").toLowerCase();
    return {
      verdict: v === "yes" ? "yes" : v === "no" ? "no" : "?",
      reason: typeof p.reason === "string" ? p.reason : "",
    };
  } catch (err) {
    return { verdict: "?", reason: err instanceof Error ? err.message : String(err) };
  }
}

async function runCase(c: BehaviorCase, mode: AskMode): Promise<CaseResult> {
  const base = {
    id: c.id,
    mode,
    category: c.category,
    since: c.since,
    informational: c.informational,
  };
  const started = Date.now();
  let raw = "";
  let toolCalls: { toolName: string; input: unknown }[] = [];
  try {
    const res = await generateText({
      ...callOptions(mode),
      messages: messagesOf(c),
      maxRetries: 3,
    });
    raw = res.text ?? "";
    toolCalls = res.toolCalls.map((t) => ({ toolName: t.toolName, input: t.input }));
  } catch (err) {
    return {
      ...base,
      pass: false,
      latencyMs: Date.now() - started,
      checks: [],
      answer: "",
      used: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const latencyMs = Date.now() - started;

  // Read the reply as `runAsk` does: a clarify call replaces the answer.
  const call = toolCalls.find((t) => t.toolName === "ask_clarification");
  const clarify = call ? sanitizeClarify(call.input) : null;
  const read = readAnswer(raw);
  const answer = clarify ? clarify.question : read.answer;

  const checks: CheckResult[] = [];
  if (!c.clarify_ok) {
    checks.push({
      label: "plugent:answered",
      kind: "plugent",
      pass: !clarify,
      detail: clarify ? `asked back: ${clarify.question}` : undefined,
    });
  }
  if (!clarify) {
    const outOfRange = (read.used ?? []).filter((n) => n < 1 || n > c.passages.length);
    checks.push({
      label: "plugent:sources_line",
      kind: "plugent",
      pass: read.used !== null && outOfRange.length === 0,
      detail:
        read.used === null
          ? "no SOURCES line"
          : outOfRange.length > 0
            ? `names passages that do not exist: ${outOfRange.join(", ")}`
            : undefined,
    });
    checks.push({
      label: "plugent:no_passage_marks",
      kind: "plugent",
      pass: !PASSAGE_MARK.test(answer),
    });
  }
  for (const chk of c.checks) {
    if ("assert" in chk) {
      const fn = ASSERTIONS[chk.assert];
      checks.push({
        label: `assert:${chk.assert}`,
        kind: "assert",
        pass: fn ? fn(answer) : false,
        detail: fn ? undefined : "unknown assertion",
      });
    } else {
      const j = await runJudge(c, answer, chk.judge);
      checks.push({
        label: `judge(expect ${chk.expect}): ${chk.judge.slice(0, 70)}${chk.judge.length > 70 ? "…" : ""}`,
        kind: "judge",
        pass: j.verdict === chk.expect,
        detail: `verdict=${j.verdict} · ${j.reason}`,
      });
    }
  }
  return {
    ...base,
    pass: checks.every((r) => r.pass),
    latencyMs,
    checks,
    answer,
    ...(clarify ? { clarify } : {}),
    used: read.used,
  };
}

/** Runs `fn` over `items`, at most `limit` at a time, results in input order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ----------------------------------------------------------------------- main */

function validateCases(): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const c of cases) {
    if (!c.id) errs.push("a case is missing an id");
    if (seen.has(c.id)) errs.push(`duplicate id: ${c.id}`);
    seen.add(c.id);
    if (!c.question?.trim()) errs.push(`${c.id}: no question`);
    if (!c.passages?.length)
      errs.push(`${c.id}: no passages (an empty search never reaches the model)`);
    if (!c.checks?.length) errs.push(`${c.id}: no checks`);
    for (const chk of c.checks ?? []) {
      if ("assert" in chk && !ASSERTIONS[chk.assert])
        errs.push(`${c.id}: unknown assertion "${chk.assert}"`);
      if ("judge" in chk && chk.expect !== "yes" && chk.expect !== "no")
        errs.push(`${c.id}: judge check needs expect yes|no`);
    }
    for (const f of c.whole_files ?? []) {
      if (!c.passages?.some((p) => p.file_name === f))
        errs.push(`${c.id}: whole file "${f}" has no passage`);
    }
    try {
      messagesOf(c);
    } catch (err) {
      errs.push(`${c.id}: the turn does not build — ${err instanceof Error ? err.message : err}`);
    }
  }
  return errs;
}

function printBaselineDiff(results: CaseResult[], baselinePath: string) {
  let before: { results?: Pick<CaseResult, "id" | "mode" | "pass">[] };
  try {
    before = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (err) {
    console.log(
      `baseline: could not read ${baselinePath} (${err instanceof Error ? err.message : err})`,
    );
    return;
  }
  const was = new Map((before.results ?? []).map((r) => [`${r.id}@${r.mode}`, r.pass]));
  const broke = results.filter((r) => was.get(`${r.id}@${r.mode}`) === true && !r.pass);
  const fixed = results.filter((r) => was.get(`${r.id}@${r.mode}`) === false && r.pass);
  console.log(`\nvs baseline ${baselinePath}`);
  console.log(`  newly failing: ${broke.map((r) => `${r.id}@${r.mode}`).join(", ") || "none"}`);
  console.log(`  newly passing: ${fixed.map((r) => `${r.id}@${r.mode}`).join(", ") || "none"}`);
}

async function main() {
  if (DUMP_PROMPT) {
    const opts = callOptions(MODES[0] ?? "standard");
    for (const c of cases) {
      console.log(`\n${"=".repeat(70)}\n${c.id}  (model ${opts.model})\n${"=".repeat(70)}`);
      for (const m of messagesOf(c)) console.log(`--- ${m.role}\n${m.content as string}`);
    }
    return;
  }

  const shapeErrs = validateCases();
  const judgeChecks = cases.reduce((n, c) => n + c.checks.filter((k) => "judge" in k).length, 0);
  const assertChecks = cases.reduce((n, c) => n + c.checks.filter((k) => "assert" in k).length, 0);
  const model = callOptions("standard").model;

  console.log(`\n🧪 Chat BEHAVIORAL gate — ${cases.length} cases × ${MODES.join(" + ")}`);
  console.log(`   prompt:           ${CHAT_PROMPT_VERSION}`);
  console.log(`   model under test: ${model}`);
  console.log(`   judge:            ${JUDGE_MODEL}`);
  console.log(
    `   checks:           ${assertChecks} deterministic + ${judgeChecks} judged + Plugent's own`,
  );

  if (shapeErrs.length > 0) {
    console.error(`\n❌ ${shapeErrs.length} case-shape error(s):`);
    for (const e of shapeErrs) console.error(`   - ${e}`);
    process.exit(1);
  }
  if (!DO_RUN) {
    console.log("\n   Smoke OK — every case builds its turn.");
    console.log(
      `   Full run = ${cases.length * MODES.length} answer calls + ${judgeChecks * MODES.length} judge calls.`,
    );
    console.log("   Re-run with --run to execute the paid suite.\n");
    return;
  }

  const jobs = MODES.flatMap((mode) => cases.map((c) => ({ c, mode })));
  const results = await pool(jobs, CONCURRENCY, ({ c, mode }) => runCase(c, mode));
  for (const r of results) {
    const tag = r.error ? "✗ ERROR" : r.pass ? "✅ PASS" : r.informational ? "⚠️ INFO" : "❌ FAIL";
    console.log(
      `\n${tag}  ${r.id} @${r.mode}  [${r.category}${r.since ? ` · ${r.since}` : ""}]  ${r.latencyMs}ms`,
    );
    if (r.error) {
      console.log(`   ${r.error}`);
      continue;
    }
    for (const chk of r.checks) {
      console.log(
        `   ${chk.pass ? "·" : "✗"} ${chk.label}${chk.detail ? `  → ${chk.detail}` : ""}`,
      );
    }
    if (!r.pass) console.log(`   answer: ${r.answer.replace(/\s+/g, " ").slice(0, 200)}…`);
  }

  const blocking = results.filter((r) => !r.informational);
  const info = results.filter((r) => r.informational);
  const blockingFailed = blocking.filter((r) => !r.pass).map((r) => `${r.id}@${r.mode}`);
  const infoFailed = info.filter((r) => !r.pass).map((r) => `${r.id}@${r.mode}`);
  console.log(`\n${"═".repeat(60)}`);
  console.log(
    `CHAT BEHAVIORAL GATE — ${blocking.length - blockingFailed.length}/${blocking.length} blocking passed` +
      (info.length ? ` · ${info.length - infoFailed.length}/${info.length} informational` : ""),
  );
  console.log("═".repeat(60));
  if (blockingFailed.length) console.log(`FAILED: ${blockingFailed.join(", ")}`);
  if (infoFailed.length) console.log(`INFORMATIONAL (non-blocking): ${infoFailed.join(", ")}`);
  if (BASELINE) printBaselineDiff(results, BASELINE);

  mkdirSync("eval-results", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportPath = path.join("eval-results", `chat-behavior_${stamp}.json`);
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        promptVersion: CHAT_PROMPT_VERSION,
        model,
        modes: MODES,
        judge: JUDGE_MODEL,
        passed: results.filter((r) => r.pass).length,
        total: results.length,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`report → ${reportPath}\n`);

  // CI gate: a BLOCKING failure is a regression → exit 1. Informational cases never fail it.
  if (blockingFailed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
