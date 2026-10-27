/**
 * The Troubleshooting agent's two prompts and its step parser, copied from sebtember-web
 * `lib/troubleshooting/prompts.ts` (main 3fda98c, Step 1136), with the step types it imports
 * inlined below. The prompt text and the parser are VERBATIM: change them in sebtember first,
 * then copy.
 *
 * ⚠️ THE STEP IS GROUNDED OR IT IS NOT ISSUED — `exhausted` is an honest answer.
 */

export type StepOutcomeKind = "done" | "nothing" | "skip" | "fixed";
export type StepCalloutTone = "info" | "warning" | "critical" | "success";

export interface StepOutcome {
  kind: StepOutcomeKind;
  label: string;
}

export interface StepData {
  /** 1-based. */
  index: number;
  title: string;
  instruction: string;
  /** Which document and page the step comes from, when the model names one. */
  visual: { kind: "photo"; caption: string } | { kind: "none" };
  callout?: { tone: StepCalloutTone; text: string };
  /** 2–3, one horizontal row. */
  outcomes: StepOutcome[];
}
/** A step already tried, as the next-step call is told about it. */
export interface TriedStep {
  index: number;
  title: string;
  outcomeKind: StepOutcomeKind;
  outcomeLabel: string;
}

const OUTCOME_KINDS: readonly StepOutcomeKind[] = ["done", "nothing", "skip", "fixed"];
const CALLOUT_TONES: readonly StepCalloutTone[] = ["info", "warning", "critical", "success"];

export const STEP_LIMITS = {
  MAX_TITLE_CHARS: 80,
  MAX_INSTRUCTION_CHARS: 400,
  MAX_CAPTION_CHARS: 160,
  MAX_CALLOUT_CHARS: 240,
  MAX_OUTCOME_CHARS: 40,
  MIN_OUTCOMES: 2,
  MAX_OUTCOMES: 3,
  MAX_SUMMARY_CHARS: 400,
} as const;

function languageLine(languageName: string | null): string {
  return languageName
    ? `Write every user-facing string in ${languageName}.`
    : "Write in the language the user wrote in.";
}

/**
 * The clarify-or-proceed call. The model has chat's `ask_clarification` tool
 * available (AUTO mode); calling it IS the clarifying turn, not calling it IS
 * "enough context". The reply text is not shown — the design puts a fixed line
 * on screen for that — so the prompt asks for one sentence, not an answer.
 */
export function buildClarifyPrompt(args: {
  problem: string;
  /** Earlier clarifying question/answer pairs, oldest first. */
  answered: { question: string; answer: string }[];
  hasPhoto: boolean;
  clarifyTurnsLeft: number;
  languageName: string | null;
}): string {
  const { problem, answered, hasPhoto, clarifyTurnsLeft, languageName } = args;
  const history =
    answered.length > 0
      ? `\nAlready asked and answered:\n${answered
          .map((a) => `- Q: ${a.question}\n  A: ${a.answer}`)
          .join("\n")}\n`
      : "";
  const photo = hasPhoto
    ? "\nA photo of the problem is attached. Read what it shows (a display, an error code, a part) and treat that as part of the description.\n"
    : "";
  const budget =
    clarifyTurnsLeft > 0
      ? `You may ask at most ${clarifyTurnsLeft} more clarifying question${clarifyTurnsLeft === 1 ? "" : "s"} in this session, and only if it is genuinely needed.`
      : "You may NOT ask another question in this session — proceed with what you have.";

  return `You are a troubleshooting assistant. A user is describing a problem with a device, appliance, system or material, and the fix will be looked up in their own documents (manuals, service guides, datasheets).

Your ONLY job right now is to decide whether you have enough to search those documents for a fix.

The problem, in the user's words:
"""
${problem}
"""
${photo}${history}
${budget}

Decide:
- If ONE more fact is needed before a search could find the right procedure — typically the brand and model, or the exact error code or symptom — call ask_clarification with that ONE focused question and 2-4 short, mutually exclusive options. Put your understanding of the problem so far INTO the question, so the user sees you read it (for example: "I can see error 07 on the display and no hot water. That code means something different for every manufacturer, and I don't see which boiler this is — what's the brand and model?"). Never ask for something the user already gave.
- Otherwise do NOT call the tool: reply with one short sentence acknowledging the problem. Nothing else.

${languageLine(languageName)}`;
}

/**
 * The next-step call. Returns JSON only — the schema below — and the route
 * parses it with `parseStepOutput`, which is the defensive half.
 */
export function buildStepPrompt(args: {
  problem: string;
  /** The retrieved reference material, as `retrieveContext` renders it. */
  reference: string;
  tried: TriedStep[];
  /** The outcome the user just picked, if this call follows a step. */
  lastOutcome: TriedStep | null;
  nextIndex: number;
  stepsLeft: number;
  languageName: string | null;
}): string {
  const { problem, reference, tried, lastOutcome, nextIndex, stepsLeft, languageName } = args;
  const triedBlock =
    tried.length > 0
      ? `\nSteps already tried, in order, with what the user reported:\n${tried
          .map((t) => `${t.index}. ${t.title} -> ${t.outcomeLabel} (${t.outcomeKind})`)
          .join("\n")}\n`
      : "\nNo steps have been tried yet.\n";
  const last = lastOutcome
    ? `\nThe user just reported on step ${lastOutcome.index} ("${lastOutcome.title}"): "${lastOutcome.outcomeLabel}" (${lastOutcome.outcomeKind}).\n`
    : "";

  return `You are a troubleshooting assistant walking a user through diagnosing and fixing a problem, ONE step at a time, using ONLY the reference material below (excerpts from the user's own manuals and documents).

The problem:
"""
${problem}
"""
${triedBlock}${last}
Reference material (the only source of procedures you may use):
<reference>
${reference || "(nothing was retrieved)"}
</reference>

Return ONE JSON object and nothing else, in exactly one of these three shapes:

1. The next step to try:
{
  "kind": "step",
  "title": "short imperative headline, e.g. Reset the boiler",
  "instruction": "one or two sentences: exactly what to do, in plain words",
  "visual": { "caption": "which document and page the step comes from, e.g. From the service manual, page 12 — the reset button" } | null,
  "callout": { "tone": "warning" | "info" | "critical", "text": "a safety or gotcha note, only if the documents give one" } | null,
  "outcomes": [ { "kind": "done" | "nothing" | "skip" | "fixed", "label": "short button label" }, ... ]
}

2. The problem is fixed:
{ "kind": "resolved", "summary": "one or two sentences: what was wrong and what fixed it" }

3. Nothing left to try from the documents:
{ "kind": "exhausted", "summary": "one or two sentences: what was tried and what the user should do next" }

Rules:
- A step must come from the reference material. If the material contains no procedure for this problem that has not already been tried, return "exhausted" — never invent a procedure.
- The most likely cause first; ${stepsLeft} step${stepsLeft === 1 ? "" : "s"} may still be issued after this one, so do not pad.
- 2 or 3 outcomes, in one row. Use "done" for "I did it" when the result is not yet known, "nothing" for "it made no difference", "skip" to move on, and "fixed" when the step could end the problem (label it as the user would say it, e.g. "It works now"). Do not offer "fixed" on a purely diagnostic step.
- If the user's last outcome was "fixed", return "resolved".
- If the last outcome was a diagnostic reading (e.g. a gauge in the red), the next step follows FROM it.
- Keep every string short. This step number is ${nextIndex}.

${languageLine(languageName)}`;
}

/* ------------------------------------------------------------------ parsing */

export type StepOutput =
  | { kind: "step"; step: Omit<StepData, "index"> }
  | { kind: "resolved"; summary: string }
  | { kind: "exhausted"; summary: string };

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function outcomes(v: unknown): StepOutcome[] {
  if (!Array.isArray(v)) return [];
  const out: StepOutcome[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (raw === null || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const label = str(o.label, STEP_LIMITS.MAX_OUTCOME_CHARS);
    const kind = OUTCOME_KINDS.includes(o.kind as StepOutcomeKind)
      ? (o.kind as StepOutcomeKind)
      : null;
    if (!label || !kind || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push({ kind, label });
    if (out.length === STEP_LIMITS.MAX_OUTCOMES) break;
  }
  return out;
}

/**
 * Parse the next-step JSON defensively. Returns null when the output is not one
 * of the three shapes — the route then reports a failed turn (unbilled), never
 * a half-step. An `outcomes` list under the minimum gets a default pair, so a
 * grounded instruction is not thrown away over button copy.
 */
export function parseStepOutput(raw: string): StepOutput | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The model sometimes wraps JSON in a fence despite the mime type.
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  if (o.kind === "resolved" || o.kind === "exhausted") {
    const summary = str(o.summary, STEP_LIMITS.MAX_SUMMARY_CHARS);
    return { kind: o.kind, summary };
  }
  if (o.kind !== "step") return null;

  const title = str(o.title, STEP_LIMITS.MAX_TITLE_CHARS);
  const instruction = str(o.instruction, STEP_LIMITS.MAX_INSTRUCTION_CHARS);
  if (!title || !instruction) return null;

  const caption =
    o.visual !== null && typeof o.visual === "object"
      ? str((o.visual as Record<string, unknown>).caption, STEP_LIMITS.MAX_CAPTION_CHARS)
      : "";
  const visual: StepData["visual"] = caption ? { kind: "photo", caption } : { kind: "none" };

  let callout: StepData["callout"];
  if (o.callout !== null && typeof o.callout === "object") {
    const c = o.callout as Record<string, unknown>;
    const text = str(c.text, STEP_LIMITS.MAX_CALLOUT_CHARS);
    if (text) {
      const tone = CALLOUT_TONES.includes(c.tone as StepCalloutTone)
        ? (c.tone as StepCalloutTone)
        : "info";
      callout = { tone, text };
    }
  }

  let list = outcomes(o.outcomes);
  if (list.length < STEP_LIMITS.MIN_OUTCOMES) {
    list = [
      { kind: "done", label: "Done" },
      { kind: "nothing", label: "Nothing changed" },
    ];
  }

  return {
    kind: "step",
    step: { title, instruction, visual, ...(callout ? { callout } : {}), outcomes: list },
  };
}

/** The fixed line the design puts on screen between the last answer and the
 *  first step (board I): plain copy, no chrome, not model-written. */
export const ENOUGH_CONTEXT_COPY = "Now I have enough context — let me check for a solution.";
