/**
 * Troubleshooting — Sebtember's TROUBLESHOOTING (Step 1136), ported: the user describes a
 * fault (text, optionally a photo), the agent asks at most two clarifying questions, then
 * gives ONE step at a time from the user's own documents, and the user reports what
 * happened with the step's outcome buttons.
 *
 * Each request is one turn, sebtember's two calls with sebtember's prompts
 * (`troubleshoot-prompts.ts`):
 *   - CLARIFY-OR-PROCEED, while the run is new or clarifying and under the cap: the model
 *     may call `ask_clarification` (one question, 2-4 chips). No call = proceed.
 *   - NEXT-STEP: `searchKnowledge` for the problem (charged by sebtember as
 *     `{requestId}-search`), then a closed JSON reply: a step, `resolved` or `exhausted`.
 * The model work of the turn is charged ONCE, as `{requestId}-turn`, on Ask's divisors.
 *
 * ⚠️ `fixed` IS THE USER'S FACT: a picked "fixed" resolves the run in CODE whatever the model
 * returns. Only the CURRENT step's outcome is accepted.
 * ⚠️ A step the documents do not support is not issued; 8 steps max, 2 clarifies max.
 * ⚠️ PASSAGES ARE DATA — the reference block is the user's stored text, never instructions.
 *
 * Differs from sebtember on purpose: one gateway model (the clarify tool and the photo both
 * work there, so no native-model pin is needed). The reply language is the user's Sebtember
 * language, as in sebtember ("the language the user wrote in" when they set none).
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { generateText, type ModelMessage } from "ai";
import {
  AskRefused,
  type AskSource,
  type AskUsage,
  billedAnswerTokens,
  type CatalogueInfo,
  ownerLabel,
} from "@/lib/agents/ask";
import { CLARIFY_TOOL, sanitizeClarify } from "@/lib/agents/clarify";
import { readUserContext } from "@/lib/agents/profile";
import { sanitizeForPrompt } from "@/lib/agents/sanitize";
import {
  buildClarifyPrompt,
  buildStepPrompt,
  parseStepOutput,
  type StepOutcomeKind,
  type TriedStep,
} from "@/lib/agents/troubleshoot-prompts";
import {
  claimTsRun,
  commitTsTurns,
  readTsPhoto,
  readTsRun,
  releaseTsRun,
  TS_NEW_STATE,
  type TsState,
  type TsTurn,
  type TsTurnBody,
} from "@/lib/runs";
import {
  charge,
  getBalance,
  getKnowledgeCatalogues,
  type KnowledgePassage,
  SebtemberApiError,
  searchKnowledge,
} from "@/lib/sebtember/products";
import { agentCharge, logCharge, searchCharge, type TurnCharge, usageOf } from "@/lib/usage";

export const TS_MODEL = process.env.PLUGENT_TROUBLESHOOTING_MODEL?.trim() || "openai/gpt-5.4-mini";
export const TS_LIMITS = {
  MAX_TEXT_CHARS: 4000,
  MAX_CLARIFY_TURNS: 2,
  MAX_STEPS: 8,
  /** The photo as the model reads it (base64 of a downscaled JPEG); a Firestore doc is 1 MiB. */
  MAX_PHOTO_CHARS: 900_000,
  MAX_THUMB_CHARS: 60_000,
  PASSAGES: 12,
  REFERENCE_MAX_CHARS: 24_000,
  SOURCES_SHOWN: 3,
} as const;
const MODEL_TIMEOUT_MS = 45_000;

export class TsRefused extends Error {
  constructor(readonly code: "run_not_found" | "busy" | "finished" | "not_current_step") {
    super(code);
  }
}

export interface TsRequest {
  runId: string | null;
  text: string;
  photo: { mediaType: string; data: string } | null;
  thumb: string | null;
  outcome: { stepId: string; kind: StepOutcomeKind } | null;
}

export interface TsResponse {
  runId: string;
  state: TsState;
  turns: TsTurn[];
  tokens: number;
  balanceAfter: number | null;
  charged: boolean;
}

function userContent(
  text: string,
  photo: { mediaType: string; data: string } | null,
): ModelMessage[] {
  return [
    {
      role: "user",
      content: [
        { type: "text", text },
        ...(photo
          ? [{ type: "image" as const, image: photo.data, mediaType: photo.mediaType }]
          : []),
      ],
    },
  ];
}

/** Up to SOURCES_SHOWN files the step was read from, each once, with the first page cited. */
function stepSources(
  passages: KnowledgePassage[],
  catalogues: ReadonlyMap<string, CatalogueInfo>,
): AskSource[] {
  const out: AskSource[] = [];
  const seen = new Set<string>();
  for (const p of passages) {
    const key = p.file_id ?? p.file_name;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      n: out.length + 1,
      fileName: p.file_name,
      catalogueName: p.catalogue_name,
      page: p.page,
      library: catalogues.get(p.catalogue_id)?.library ?? false,
      owner: ownerLabel(catalogues.get(p.catalogue_id)),
    });
    if (out.length === TS_LIMITS.SOURCES_SHOWN) break;
  }
  return out;
}

/** One request: the user's turn and the agent's answer to it, saved together. */
export async function respondTroubleshooting(uid: string, req: TsRequest): Promise<TsResponse> {
  let state: TsState = TS_NEW_STATE;
  let turns: TsTurn[] = [];
  if (req.runId) {
    const claimed = await claimTsRun(uid, req.runId);
    if (claimed === null) throw new TsRefused("run_not_found");
    if (claimed === "busy") throw new TsRefused("busy");
    state = claimed;
  }
  const runId = req.runId;
  try {
    if (runId) turns = (await readTsRun(uid, runId))?.turns ?? [];
    return await respond(uid, runId, state, turns, req);
  } catch (err) {
    if (runId) await releaseTsRun(uid, runId);
    throw err;
  }
}

async function respond(
  uid: string,
  runId: string | null,
  state: TsState,
  turns: TsTurn[],
  req: TsRequest,
): Promise<TsResponse> {
  if (state.status === "resolved" || state.status === "exhausted") {
    throw new TsRefused("finished");
  }

  // ---- the outcome, against the step it belongs to: only the current, unanswered one.
  let picked: (TriedStep & { stepId: string }) | null = null;
  if (req.outcome) {
    const { stepId, kind } = req.outcome;
    const turn = turns.find((t) => t.id === stepId);
    if (!turn || turn.role !== "step" || turn.done || turn.step.index !== state.stepCount) {
      throw new TsRefused("not_current_step");
    }
    picked = {
      stepId,
      index: turn.step.index,
      title: turn.step.title,
      outcomeKind: kind,
      outcomeLabel:
        turn.step.outcomes.find((o) => o.kind === kind)?.label ??
        (kind === "fixed" ? "It works now" : kind),
    };
  }

  const wallet = await getBalance(uid);
  if (wallet.balance < wallet.minimum) throw new AskRefused("low_balance");
  const requestId = randomUUID();

  const text = picked ? picked.outcomeLabel : req.text;
  // The user's Sebtember language (fail-open), read while the turn runs.
  const userContext = readUserContext(uid);
  const problem = picked ? state.problem : [state.problem, req.text].filter(Boolean).join("\n");
  const photo = req.photo ?? (runId ? await readTsPhoto(uid, runId) : null);
  const out: TsTurnBody[] = [
    {
      role: "user",
      text,
      thumb: picked ? null : req.thumb,
      outcome: picked
        ? { stepId: picked.stepId, kind: picked.outcomeKind, label: picked.outcomeLabel }
        : null,
    },
  ];
  const usages: AskUsage[] = [];
  let searchTokens = 0;
  let searchCharges: TurnCharge[] = [];
  let balanceAfter: number | null = null;
  const next: TsState = { ...state, problem };

  // ---- 1. clarify-or-proceed, on a text turn early in the run.
  let proceed = true;
  if (
    !picked &&
    (state.status === "draft" || state.status === "clarifying") &&
    state.clarifyCount < TS_LIMITS.MAX_CLARIFY_TURNS
  ) {
    const answered = clarifyPairs(turns);
    const result = await generateText({
      model: TS_MODEL,
      messages: userContent(
        buildClarifyPrompt({
          problem: sanitizeForPrompt(problem),
          answered,
          hasPhoto: photo !== null,
          clarifyTurnsLeft: TS_LIMITS.MAX_CLARIFY_TURNS - state.clarifyCount,
          languageName: (await userContext).languageName,
        }),
        photo,
      ),
      tools: { ask_clarification: CLARIFY_TOOL },
      toolChoice: "auto",
      maxOutputTokens: 2000,
      timeout: MODEL_TIMEOUT_MS,
      providerOptions: { openai: { reasoningEffort: "low" } },
    });
    usages.push(result.totalUsage);
    const call = result.toolCalls.find((c) => c.toolName === "ask_clarification");
    const clarify = call ? sanitizeClarify(call.input) : null;
    if (clarify) {
      out.push({ role: "clarify", ...clarify });
      next.status = "clarifying";
      next.clarifyCount += 1;
      proceed = false;
    }
  }

  // ---- 2. the next step, grounded.
  if (proceed) {
    if (!picked && (state.status === "draft" || state.status === "clarifying")) {
      out.push({ role: "context" });
    }
    const catalogueInfo = getKnowledgeCatalogues(uid)
      .then(
        ({ catalogues }) =>
          new Map<string, CatalogueInfo>(
            catalogues.map((c) => [c.id, { library: c.library === true, owner: c.owner }]),
          ),
      )
      .catch(() => new Map<string, CatalogueInfo>());
    const query = picked ? `${problem}\n${picked.title}: ${picked.outcomeLabel}` : problem;
    let search: Awaited<ReturnType<typeof searchKnowledge>>;
    try {
      search = await searchKnowledge(
        uid,
        wallet.source,
        sanitizeForPrompt(query, 2000),
        requestId,
        TS_LIMITS.PASSAGES,
      );
    } catch (err) {
      if (err instanceof SebtemberApiError && err.code === "not_connected") {
        throw new AskRefused("not_connected");
      }
      throw err;
    }
    searchTokens = search.charged.tokens;
    searchCharges = searchCharge(requestId, search);
    balanceAfter = search.balanceAfter;
    const reference = search.passages
      .map(
        (p) =>
          `--- ${[p.file_name, p.page ? `p. ${p.page}` : null].filter(Boolean).join(", ")}\n${p.text}`,
      )
      .join("\n\n")
      .slice(0, TS_LIMITS.REFERENCE_MAX_CHARS);

    const tried: TriedStep[] = turns.flatMap((t) =>
      t.role === "step" && t.done
        ? [
            {
              index: t.step.index,
              title: t.step.title,
              outcomeKind: t.done.kind,
              outcomeLabel: t.done.label,
            },
          ]
        : [],
    );
    const nextIndex = state.stepCount + 1;
    const result = await generateText({
      model: TS_MODEL,
      messages: userContent(
        buildStepPrompt({
          problem: sanitizeForPrompt(problem),
          reference,
          tried: picked ? [...tried, picked] : tried,
          lastOutcome: picked,
          nextIndex,
          stepsLeft: Math.max(TS_LIMITS.MAX_STEPS - nextIndex, 0),
          languageName: (await userContext).languageName,
        }),
        photo,
      ),
      maxOutputTokens: 3000,
      timeout: MODEL_TIMEOUT_MS,
      providerOptions: { openai: { reasoningEffort: "low" } },
    });
    usages.push(result.totalUsage);
    let parsed = parseStepOutput(result.text);
    if (!parsed) throw new Error("step output did not parse");
    // ⚠️ The user's fact wins.
    if (picked?.outcomeKind === "fixed" && parsed.kind !== "resolved") {
      parsed = {
        kind: "resolved",
        summary: parsed.kind === "exhausted" ? parsed.summary : "The problem is fixed.",
      };
    }
    // The cap: after the last permitted step, nothing but an ending.
    if (parsed.kind === "step" && nextIndex > TS_LIMITS.MAX_STEPS) {
      parsed = {
        kind: "exhausted",
        summary: "That is every procedure the documents give for this problem.",
      };
    }
    const sources = stepSources(search.passages, await catalogueInfo);
    if (parsed.kind === "step") {
      out.push({
        role: "step",
        step: { index: nextIndex, ...parsed.step },
        sources,
        done: null,
        tokens: 0,
      });
      next.status = "stepping";
      next.stepCount = nextIndex;
    } else {
      out.push({
        role: "end",
        result: parsed.kind,
        summary: parsed.summary,
        sources: parsed.kind === "resolved" ? sources : [],
        tokens: 0,
      });
      next.status = parsed.kind;
    }
  }

  // ---- 3. one charge for the turn's model work, to the source the balance returned.
  const turnTokens = usages.reduce((sum, u) => sum + billedAnswerTokens(u), 0);
  // One entry per model call (clarify, step), raw counts: logged, sent with the line, kept.
  const usage = usages.map((u) => usageOf(TS_MODEL, u));
  logCharge("troubleshooting", uid, `${requestId}-turn`, turnTokens, usage);
  let charged = true;
  if (turnTokens > 0) {
    const line = {
      id: `${requestId}-turn`,
      tokens: turnTokens,
      operation: "troubleshooting_turn",
      usage,
    };
    const res = await charge(uid, wallet.source, [line]).catch(() =>
      charge(uid, wallet.source, [line]).catch((err) => {
        console.error(`[troubleshooting] charge failed uid=${uid} req=${requestId}`, err);
        return null;
      }),
    );
    if (res) balanceAfter = res.balanceAfter;
    else charged = false;
  }
  const tokens = searchTokens + turnTokens;
  const last = out.at(-1);
  if (last && (last.role === "step" || last.role === "end")) last.tokens = tokens;

  const nextSeq = turns.reduce((max, t) => Math.max(max, t.seq), -1) + 1;
  const saved = await commitTsTurns(uid, runId, {
    title: req.text || "Photo of a problem",
    state: next,
    tokens,
    turns: out,
    stepDone: picked
      ? { stepId: picked.stepId, kind: picked.outcomeKind, label: picked.outcomeLabel }
      : null,
    photo: req.photo,
    nextSeq,
    usage,
    charges: [
      ...searchCharges,
      ...agentCharge(`${requestId}-turn`, "Step", turnTokens, usage, charged),
    ],
  });
  return {
    runId: saved.runId,
    state: next,
    turns: out.map((t, i) => ({ ...t, id: saved.turnIds[i] ?? "", seq: nextSeq + i })),
    tokens,
    balanceAfter,
    charged,
  };
}

/** The clarifying questions asked so far, each with the user's answer (the next turn). */
function clarifyPairs(turns: TsTurn[]): { question: string; answer: string }[] {
  const pairs: { question: string; answer: string }[] = [];
  turns.forEach((t, i) => {
    const reply = turns[i + 1];
    if (t.role === "clarify" && reply?.role === "user") {
      pairs.push({ question: t.question, answer: sanitizeForPrompt(reply.text, 500) });
    }
  });
  return pairs;
}
