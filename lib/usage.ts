/**
 * Model usage — what each model call actually spent, in the provider's RAW counts.
 *
 * Operator, 2026-10-28: every charge must show which model ran and its input and output
 * tokens. Each charge line sends them to sebtember as `usage` (sebtember Step 1182), which
 * stores them on the line's record and logs them; Plugent logs the same line here and keeps
 * them on the turn. They never price a line: the billed figure is still computed from the
 * same usage by each agent's own divisors.
 */
import type { ChargeUsage } from "@/lib/sebtember/products";

/** The AI SDK's resolved usage, as the agents read it. */
export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number; textTokens?: number };
}

const count = (v: number | undefined) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;

/** One model call's raw counts. `output` includes the reasoning, as the provider reports it. */
export function usageOf(model: string, usage: ModelUsage): ChargeUsage {
  const reasoning = count(usage.outputTokenDetails?.reasoningTokens);
  const cached = count(usage.inputTokenDetails?.cacheReadTokens);
  return {
    model,
    input: count(usage.inputTokens),
    output: count(usage.outputTokens),
    ...(reasoning ? { reasoning } : {}),
    ...(cached ? { cached } : {}),
  };
}

/** `model in=… out=… [reasoning=…] [cached=…]`, one fragment per call. */
export function formatUsage(usage: ChargeUsage[]): string {
  if (usage.length === 0) return "usage=none";
  return usage
    .map(
      (u) =>
        `${u.model} in=${u.input} out=${u.output}` +
        (u.reasoning !== undefined ? ` reasoning=${u.reasoning}` : "") +
        (u.cached !== undefined ? ` cached=${u.cached}` : ""),
    )
    .join(" | ");
}

/** The one log line per charge: what ran, what it spent, what was billed. */
export function logCharge(
  agent: string,
  uid: string,
  lineId: string,
  billed: number,
  usage: ChargeUsage[],
): void {
  console.log(
    `[charge] ${agent} uid=${uid} line=${lineId} billed=${billed} tk ${formatUsage(usage)}`,
  );
}

/**
 * One line a turn cost, as the Usage page shows it: who charged it (Plugent's own model work, or
 * sebtember serving data / running its engine), what it was, the tokens taken from the wallet and
 * the model calls behind it. Kept on the turn as `charges`.
 */
export interface TurnCharge {
  line: string;
  by: "plugent" | "sebtember";
  what: string;
  tokens: number;
  usage?: ChargeUsage[];
}

/** Sebtember's knowledge search, charged by sebtember as `{requestId}-search`. None when it was free. */
export function searchCharge(
  requestId: string,
  search: { charged: { tokens: number }; usage?: ChargeUsage[] },
): TurnCharge[] {
  if (!(search.charged.tokens > 0)) return [];
  return [
    {
      line: `${requestId}-search`,
      by: "sebtember",
      what: "Knowledge search",
      tokens: search.charged.tokens,
      ...(search.usage?.length ? { usage: search.usage } : {}),
    },
  ];
}

/** Plugent's own model work. None when nothing was taken (zero tokens, or the charge failed). */
export function agentCharge(
  line: string,
  what: string,
  tokens: number,
  usage: ChargeUsage[],
  charged: boolean,
): TurnCharge[] {
  return tokens > 0 && charged ? [{ line, by: "plugent", what, tokens, usage }] : [];
}

/** The same line when its charge failed and it was kept for a retry (`lib/unpaid.ts`): saved
 *  with the turn, so paying it later adds it to the turn's `charges`. None when it was paid. */
export function unpaidCharge(
  line: string,
  what: string,
  tokens: number,
  usage: ChargeUsage[],
  charged: boolean,
): TurnCharge[] {
  return tokens > 0 && !charged ? [{ line, by: "plugent", what, tokens, usage }] : [];
}
