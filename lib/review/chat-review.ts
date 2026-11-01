/**
 * The Chat review — the judging half of Chat's self-improvement loop (`scripts/chat-review.ts`).
 *
 * The design sebtember agreed when it paused its aggregate grounding digest (moved to sebtember
 * `docs/chat-runtime.md`, "Why the grounding digest was paused"): at a handful of answers a week
 * statistics say nothing, so an INDEPENDENT strong judge (Opus-tier, another family than Chat's
 * model) reads every WHOLE CONVERSATION — the failures that ship are multi-turn — reconstructs what
 * the user wanted, drafts the best answer obtainable FROM THE RETRIEVED CONTEXT (never from its own
 * knowledge, or it invents an ideal the documents do not support), compares it with what shipped,
 * and routes each material gap to ONE lever:
 *   - content    — the documents do not hold it (a catalogue owner's job);
 *   - retrieval  — the documents hold it but the search did not bring it (sebtember's search);
 *   - generation — the passages held it and the answer missed, garbled or under-used it (our prompt);
 *   - grounding  — the answer said something the passages do not support (our prompt).
 * Only generation and grounding are Plugent's to fix, so only they feed the proposal.
 *
 * ⚠️ THE EVIDENCE IS USERS' DATA and this repo is PUBLIC: the per-conversation results stay in
 * Plugent's Firestore (`chat_reviews`) and a gitignored file; what the proposal carries out —
 * a rule, a prompt edit, eval cases — is written fresh by the proposer, which is told so.
 */
import { generateText } from "ai";
import type { AskTrace } from "@/lib/agents/ask";
import { SYSTEM_INSTRUCTION_GPT } from "@/lib/agents/chat-prompt";

export const JUDGE_MODEL =
  process.env.CHAT_REVIEW_JUDGE_MODEL?.trim() || "anthropic/claude-opus-5.5";
export const LEVERS = ["content", "retrieval", "generation", "grounding"] as const;
export type Lever = (typeof LEVERS)[number];
/** The levers a Chat prompt change can move. */
export const PROMPT_LEVERS: readonly Lever[] = ["generation", "grounding"];

/** Passage text is capped in the judge's view; a trace keeps the whole passage. */
const PASSAGE_CHARS = 1500;

export interface ReviewTurn {
  turnId: string;
  question: string;
  kind: "answer" | "not_covered";
  answer: string;
  clarify: boolean;
  stopped: boolean;
  trace: (AskTrace & { createdAtMs: number }) | null;
}

export interface Conversation {
  uid: string;
  runId: string;
  turns: ReviewTurn[];
  /** Notes users sent about an answer in this run (`answer_feedback`). */
  feedback: string[];
}

export interface Gap {
  turn: number;
  lever: Lever;
  severity: "material" | "minor";
  what: string;
  evidence: string;
  fix: string;
}

export interface Judgement {
  runId: string;
  uid: string;
  intent: string;
  verdict: "good" | "minor" | "material";
  gaps: Gap[];
  error?: string;
}

/** One conversation as the judge reads it: every turn, what the model saw, what it said. */
export function renderConversation(c: Conversation): string {
  const parts = c.turns.map((t, i) => {
    const tr = t.trace;
    const passages = tr?.passages.length
      ? tr.passages
          .map((p, k) => {
            const where = [
              p.catalogue_name && `Catalogue: ${p.catalogue_name}`,
              p.page && `Page: ${p.page}`,
            ]
              .filter(Boolean)
              .join(" · ");
            return `  [Passage ${k + 1}] ${p.file_name}${where ? ` (${where})` : ""}${p.kind ? ` — ${p.kind}` : ""}\n    ${p.text.slice(0, PASSAGE_CHARS).replace(/\n/g, "\n    ")}`;
          })
          .join("\n")
      : "  (no passages)";
    const meta = tr
      ? `retrieval strength: ${tr.retrievalStrength}; complete files: ${tr.wholeFiles.join(", ") || "none"}; ` +
        `prompt ${tr.promptVersion}, ${tr.model}, ${tr.mode} mode; the answer named passages: ${
          tr.used === null ? "none stated" : tr.used.join(", ") || "none"
        }`
      : "no trace kept for this turn (older than the trace, or not saved)";
    const shown =
      t.kind === "not_covered"
        ? "(nothing — the search found no passages, so the user was told their documents do not cover it)"
        : t.clarify
          ? `(asked back) ${t.answer}`
          : `${t.answer}${t.stopped ? "\n  (the user pressed Stop here)" : ""}`;
    return `### Turn ${i + 1}\nUSER: ${t.question}\nRETRIEVED (${meta}):\n${passages}\nSHIPPED ANSWER:\n${shown}`;
  });
  const fb = c.feedback.length
    ? `\n\n### Notes the user sent about these answers\n${c.feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  return parts.join("\n\n") + fb;
}

export function judgePrompt(c: Conversation): string {
  return `You review one conversation of a document Q&A assistant ("Chat"). The user asks about their own documents; for each turn a search returned passages and the assistant answered from them under its system prompt.

Do this, in order:
1. Reconstruct what the user actually wanted across the WHOLE conversation (follow-ups change meaning).
2. For each assistant turn, draft — silently — the best answer obtainable FROM THAT TURN'S RETRIEVED PASSAGES ONLY. Never use your own world knowledge to imagine an ideal the documents do not support. General domain knowledge is allowed only where the assistant itself is allowed it: answering a general how/why question, clearly labelled.
3. Compare the shipped answer with your draft. A gap is MATERIAL when the user would act on something wrong, miss something the passages held that their question needed, or be refused something answerable; MINOR when it is style, length or a small omission.
4. Route EACH gap to ONE lever:
   - "content": the documents (as far as the passages and the question show) do not hold it — only the document owner can fix it.
   - "retrieval": the right material evidently exists but the search did not bring it, or brought the wrong subject — a search fix.
   - "generation": the passages held it and the answer missed it, mis-read it, mis-structured it, or asked back needlessly.
   - "grounding": the answer states something the passages do not support (invented, transferred from another subject, wrong number).
Do not report a gap you cannot point to in the transcript. A good answer gets no gaps.

Reply with ONLY this JSON (no prose, no code fence):
{"intent":"one sentence","verdict":"good"|"minor"|"material","gaps":[{"turn":<number>,"lever":"content"|"retrieval"|"generation"|"grounding","severity":"material"|"minor","what":"one sentence","evidence":"the decisive passage or answer words, quoted briefly","fix":"one sentence: what would have made it right"}]}

## The assistant's system prompt (for reference; judge the answers, not the prompt)
${SYSTEM_INSTRUCTION_GPT.slice(0, 6000)}…

## The conversation
${renderConversation(c)}`;
}

/** The judge's JSON, validated; anything malformed becomes an error result, never a guess. */
export function parseJudgement(c: Conversation, raw: string): Judgement {
  const base = { runId: c.runId, uid: c.uid };
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  try {
    if (s < 0 || e <= s) throw new Error("no JSON object");
    const j = JSON.parse(raw.slice(s, e + 1)) as Partial<Judgement> & { gaps?: Partial<Gap>[] };
    const verdict =
      j.verdict === "good" || j.verdict === "minor" || j.verdict === "material" ? j.verdict : null;
    if (!verdict) throw new Error(`bad verdict ${String(j.verdict)}`);
    const gaps: Gap[] = (Array.isArray(j.gaps) ? j.gaps : [])
      .filter(
        (g) =>
          LEVERS.includes(g.lever as Lever) &&
          (g.severity === "material" || g.severity === "minor"),
      )
      .map((g) => ({
        turn: Number(g.turn) || 0,
        lever: g.lever as Lever,
        severity: g.severity as Gap["severity"],
        what: String(g.what ?? "").slice(0, 400),
        evidence: String(g.evidence ?? "").slice(0, 600),
        fix: String(g.fix ?? "").slice(0, 400),
      }));
    return { ...base, intent: String(j.intent ?? "").slice(0, 300), verdict, gaps };
  } catch (err) {
    return {
      ...base,
      intent: "",
      verdict: "good",
      gaps: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function judge(c: Conversation): Promise<Judgement> {
  try {
    const res = await generateText({
      model: JUDGE_MODEL,
      prompt: judgePrompt(c),
      maxOutputTokens: 2000,
      maxRetries: 3,
    });
    return parseJudgement(c, res.text ?? "");
  } catch (err) {
    return {
      runId: c.runId,
      uid: c.uid,
      intent: "",
      verdict: "good",
      gaps: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface Tally {
  conversations: number;
  turns: number;
  verdicts: Record<Judgement["verdict"], number>;
  material: Record<Lever, number>;
  minor: Record<Lever, number>;
  errors: number;
}

export function tally(conversations: Conversation[], results: Judgement[]): Tally {
  const zero = () => Object.fromEntries(LEVERS.map((l) => [l, 0])) as Record<Lever, number>;
  const t: Tally = {
    conversations: conversations.length,
    turns: conversations.reduce((n, c) => n + c.turns.length, 0),
    verdicts: { good: 0, minor: 0, material: 0 },
    material: zero(),
    minor: zero(),
    errors: 0,
  };
  for (const r of results) {
    if (r.error) t.errors++;
    else t.verdicts[r.verdict]++;
    for (const g of r.gaps) t[g.severity][g.lever]++;
  }
  return t;
}

export interface Proposal {
  title: string;
  /** The recurring failure, described in general terms (no user data). */
  problem: string;
  /** An edit to Chat's prompt: replace `find` (an exact substring) with `replace`; empty `find` appends. */
  edit: { find: string; replace: string };
  /** New behaviour cases for `lib/agents/eval/chat-behavior-cases.json`, written fresh (synthetic). */
  cases: unknown[];
  expectedEffect: string;
  /** How many material prompt-lever gaps it addresses, of how many. */
  addresses: { gaps: number; of: number };
}

export function proposerPrompt(gaps: Gap[]): string {
  return `You improve the system prompt of a document Q&A assistant. Below are the material failures a reviewer found over the last weeks in which the passages held what was needed (generation) or the answer said what they did not support (grounding).

Pick the ONE change to the prompt that would fix the most of them without breaking what works. Prefer sharpening an existing rule over adding a new section; keep the prompt lean (every token is paid per turn).

⚠️ PRIVACY: the failures below quote real users' documents and questions. Your output will be PUBLISHED in a public repository. Write the problem, the edit and the cases in GENERAL terms, with INVENTED products, numbers and names — never copy a question, a passage, a product, a company or a number from the failures.

Reply with ONLY this JSON (no prose, no code fence):
{"title":"under 70 chars","problem":"2-3 sentences, general","edit":{"find":"an EXACT substring of the current prompt to replace, or \\"\\" to append at the end","replace":"the new text"},"cases":[1-3 objects shaped {"id":"kebab-id","category":"...","since":"review","retrieval_strength":"rich"|"normal"|"thin","passages":[{"file_name":"...","catalogue_name":"...","text":"..."}],"question":"...","checks":[{"judge":"a yes/no rubric; yes = the behaviour holds","expect":"yes"}]}],"expectedEffect":"one sentence","addresses":{"gaps":<n>,"of":${gaps.length}}}

## The failures
${gaps.map((g, i) => `${i + 1}. [${g.lever}] ${g.what} — fix: ${g.fix} (evidence: ${g.evidence})`).join("\n")}

## The current prompt
${SYSTEM_INSTRUCTION_GPT}`;
}

export function parseProposal(raw: string): Proposal | { error: string } {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  try {
    if (s < 0 || e <= s) throw new Error("no JSON object");
    const p = JSON.parse(raw.slice(s, e + 1)) as Proposal;
    if (!p.title || !p.edit || typeof p.edit.replace !== "string")
      throw new Error("missing title or edit");
    p.edit.find = typeof p.edit.find === "string" ? p.edit.find : "";
    // ⚠️ An edit that names text the prompt does not hold cannot be applied faithfully.
    if (p.edit.find && !SYSTEM_INSTRUCTION_GPT.includes(p.edit.find))
      throw new Error("edit.find is not in the prompt");
    p.cases = Array.isArray(p.cases) ? p.cases : [];
    return p;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function propose(gaps: Gap[]): Promise<Proposal | { error: string }> {
  if (gaps.length === 0) return { error: "no material generation or grounding gap to fix" };
  try {
    const res = await generateText({
      model: JUDGE_MODEL,
      prompt: proposerPrompt(gaps),
      maxOutputTokens: 4000,
      maxRetries: 3,
    });
    return parseProposal(res.text ?? "");
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
