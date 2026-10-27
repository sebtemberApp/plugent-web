/**
 * Specification and Quotation — Sebtember's SPECIFICATION (BOM) and QUOTATION (RFQ) agents,
 * ported: the user names one device or material and gets a design-stage reference (four
 * sections) or a brand-neutral tender specification, drafted from their own catalogues.
 *
 * One run, like Ask (`lib/agents/ask.ts`):
 *   1. `getBalance` — gate on the floor and keep the returned `source` for every charge;
 *   2. `searchKnowledge` for the device's full datasheet (sebtember's `scopeSpecRun` query),
 *      charged by sebtember as line `{runId}-search`;
 *   3. nothing found → decline, no model call (as sebtember's spec agent does);
 *   4. the draft model with sebtember's own prompt (`spec-prompts.ts`), the passages as
 *      REFERENCE DATA, the subject as the SOURCE ANSWER, a follow-up as USER REFINEMENT;
 *   5. `charge` the draft as line `{runId}-draft`, on the agent's own billing divisors.
 *
 * ⚠️ A DECLINE IS STILL A TURN HERE. Sebtember stores nothing for a declined spec doc because
 * a document page has one subject; a Plugent run is a thread, so the clarification line is
 * shown as the reply and the user types again. Its model tokens are charged, as sebtember
 * bills a declined draft.
 * ⚠️ PASSAGES ARE DATA — wrapped as reference data, never followed as instructions.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import {
  AskRefused,
  type AskResult,
  type AskSource,
  type CatalogueInfo,
  ownerLabel,
} from "@/lib/agents/ask";
import { BOM_SYSTEM_INSTRUCTION, RFQ_SYSTEM_INSTRUCTION } from "@/lib/agents/spec-prompts";
import {
  charge,
  getBalance,
  getKnowledgeCatalogues,
  type KnowledgePassage,
  SebtemberApiError,
  searchKnowledge,
} from "@/lib/sebtember/products";

export type SpecDocAgent = "specification" | "quotation";

export const MAX_SUBJECT_CHARS = 2000;
/** Sebtember's product search returns at most 20 passages (24,000 characters). */
const MAX_PASSAGES = 20;
const DRAFT_TIMEOUT_MS = 100_000;

interface SpecDocConfig {
  instructions: string;
  model: string;
  /** Divisors on the gateway's usage (billed = raw / factor; < 1 marks up), sebtember's. */
  discounts: { input: number; reasoning: number; output: number };
  maxOutputTokens: number;
  produceLine: string;
  agentToken: string;
  operation: string;
}

const CONFIG: Record<SpecDocAgent, SpecDocConfig> = {
  // sebtember `bom.ts`: gpt-5.4-mini (Step 510), BOM_*_DISCOUNT 3.5 / 0.6 / 0.6, 8000 out.
  specification: {
    instructions: BOM_SYSTEM_INSTRUCTION,
    model: process.env.PLUGENT_SPECIFICATION_MODEL?.trim() || "openai/gpt-5.4-mini",
    discounts: { input: 3.5, reasoning: 0.6, output: 0.6 },
    maxOutputTokens: 8000,
    produceLine: "Produce the four sections now.",
    agentToken: "BOM",
    operation: "specification_draft",
  },
  // sebtember `rfq.ts`: gpt-5.4-mini (Step 505), RFQ_*_DISCOUNT 3.0 / 0.5 / 0.5, 4000 out.
  quotation: {
    instructions: RFQ_SYSTEM_INSTRUCTION,
    model: process.env.PLUGENT_QUOTATION_MODEL?.trim() || "openai/gpt-5.4-mini",
    discounts: { input: 3, reasoning: 0.5, output: 0.5 },
    maxOutputTokens: 4000,
    produceLine: "Produce the tender specification now.",
    agentToken: "RFQ",
    operation: "quotation_draft",
  },
};

interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number; textTokens?: number };
}

export function billedDraftTokens(usage: Usage, d: SpecDocConfig["discounts"]): number {
  const cached = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const input = Math.max((usage.inputTokens ?? 0) - cached, 0);
  const reasoning = usage.outputTokenDetails?.reasoningTokens ?? 0;
  const text =
    usage.outputTokenDetails?.textTokens ?? Math.max((usage.outputTokens ?? 0) - reasoning, 0);
  return (
    Math.ceil(input / d.input) + Math.ceil(reasoning / d.reasoning) + Math.ceil(text / d.output)
  );
}

/** sebtember `decline.ts`: the real output IS "## " sections; a clarification is a few
 *  short lines without one. */
export function isDeclineOutput(output: string): boolean {
  const text = output.trim();
  if (text.length === 0 || text.includes("## ") || text.length > 600) return false;
  return text.split("\n").filter((l) => l.trim().length > 0).length <= 4;
}

/** sebtember `scopeSpecRun`: retrieve the device's full datasheet, not the narrow subject. */
function searchQuery(subject: string, refinement: string | null): string {
  const named = refinement ? `${subject} ${refinement}` : subject;
  return `${named.slice(0, 600)} full technical specifications datasheet: dimensions, weight, power supply, ratings, materials, connections, performance`;
}

function referenceData(passages: KnowledgePassage[]): string {
  return passages
    .map((p) => {
      const where = [p.file_name, p.page ? `p. ${p.page}` : null].filter(Boolean).join(", ");
      return `--- ${where}\n${p.text}`;
    })
    .join("\n\n");
}

/** One card per file the draft read, for the answer's "Source:" owners (no file cards are
 *  shown for a specification: its text cites none). */
function readSources(
  passages: KnowledgePassage[],
  catalogues: ReadonlyMap<string, CatalogueInfo>,
): AskSource[] {
  const seen = new Set<string>();
  const out: AskSource[] = [];
  for (const p of passages) {
    const key = p.file_id ?? p.file_name;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      n: out.length + 1,
      fileName: p.file_name,
      catalogueName: p.catalogue_name,
      page: null,
      library: catalogues.get(p.catalogue_id)?.library ?? false,
      owner: ownerLabel(catalogues.get(p.catalogue_id)),
    });
  }
  return out;
}

/** What the run says when the user's catalogues hold nothing for the subject. */
export function noReferenceMessage(subject: string): string {
  const named = subject.trim().replace(/\s+/g, " ").slice(0, 120);
  return `Your catalogues have nothing on "${named}". Upload its datasheet to Sebtember, or check in Knowledge that the right catalogue isn't paused.`;
}

/**
 * Drafts one specification or tender text. `subject` is what the run was started with;
 * `refinement` is a follow-up typed in the same run (null for the first draft).
 */
export async function runSpecDoc(
  uid: string,
  agent: SpecDocAgent,
  subject: string,
  refinement: string | null,
): Promise<AskResult> {
  const cfg = CONFIG[agent];
  const wallet = await getBalance(uid);
  if (wallet.balance < wallet.minimum) throw new AskRefused("low_balance");
  const runId = randomUUID();

  const catalogueInfo = getKnowledgeCatalogues(uid)
    .then(
      ({ catalogues }) =>
        new Map<string, CatalogueInfo>(
          catalogues.map((c) => [c.id, { library: c.library === true, owner: c.owner }]),
        ),
    )
    .catch(() => new Map<string, CatalogueInfo>());

  let search: Awaited<ReturnType<typeof searchKnowledge>>;
  try {
    search = await searchKnowledge(
      uid,
      wallet.source,
      searchQuery(subject, refinement),
      runId,
      MAX_PASSAGES,
    );
  } catch (err) {
    if (err instanceof SebtemberApiError && err.code === "not_connected") {
      throw new AskRefused("not_connected");
    }
    throw err;
  }
  const searchTokens = search.charged.tokens;
  if (search.passages.length === 0) {
    return {
      kind: "answer",
      answer: noReferenceMessage(refinement ?? subject),
      sources: [],
      tokens: searchTokens,
      balanceAfter: search.balanceAfter,
      charged: true,
    };
  }

  const prompt = [
    "SOURCE ANSWER:",
    subject,
    "",
    `REFERENCE DATA (from the user's documents):\n${referenceData(search.passages)}`,
    "",
    refinement
      ? `USER REFINEMENT: ${refinement}\nThis is the user's authoritative instruction for THIS run. If it identifies a device or material, produce the output for THAT one from the source answer + reference data — do NOT return the "multiple items" clarification even if the source answer covers several. If it is a presentation tweak, apply it. Either way the output stays the requested ${cfg.agentToken} output.`
      : "",
    cfg.produceLine,
  ].join("\n");

  const result = await generateText({
    model: cfg.model,
    instructions: cfg.instructions,
    prompt,
    maxOutputTokens: cfg.maxOutputTokens,
    timeout: DRAFT_TIMEOUT_MS,
  });

  const draftTokens = billedDraftTokens(result.totalUsage, cfg.discounts);
  let balanceAfter = search.balanceAfter;
  let charged = true;
  if (draftTokens > 0) {
    const line = { id: `${runId}-draft`, tokens: draftTokens, operation: cfg.operation };
    // Idempotent per line id on sebtember, so one retry can never charge twice.
    const res = await charge(uid, wallet.source, [line]).catch(() =>
      charge(uid, wallet.source, [line]).catch((err) => {
        console.error(
          `[${agent}] charge failed uid=${uid} run=${runId} tokens=${draftTokens}`,
          err,
        );
        return null;
      }),
    );
    if (res) balanceAfter = res.balanceAfter;
    else charged = false;
  }

  const output = result.text.trim();
  const declined = isDeclineOutput(output);
  return {
    kind: "answer",
    answer: output,
    // A declined draft read nothing worth crediting.
    sources: declined ? [] : readSources(search.passages, await catalogueInfo),
    tokens: searchTokens + draftTokens,
    balanceAfter,
    charged,
  };
}
