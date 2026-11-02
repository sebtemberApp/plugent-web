/**
 * A Pricing run's TRACE — the evidence the Pricing review judges (`docs/pricing-loop.md`). Pure and
 * client-safe: the route builds it from sebtember's answer, the page computes the user's choice
 * with `choiceOf`, and the review renders both.
 *
 * Two traces per run, each written once when its stage ends (`lib/runs.ts` `savePricingTrace`):
 *   - `extract` — what the read found: the lines, the document's own completeness signals;
 *   - `match`   — what identification and pricing made of the confirmed lines, and later what the
 *                 user DID with it (`choice`: the options they unticked, whether they exported).
 *
 * ⚠️ USERS' DATA, KEPT 30 DAYS, NEVER PUBLISHED — the same rule as Chat's `AskTrace`: under the run
 * (`traces/{id}`, TTL on `expireAt`), never sent to the browser, never quoted in this public repo.
 * Text is cut to what the judge needs, so a 1000-line tender still fits one document.
 */
import type { IplResult } from "@/lib/agents/ipl/types";
import type { MoiSourceItem } from "@/lib/agents/moi/types";

/** Lines kept per trace; the rest are counted (`linesCut`). */
export const TRACE_MAX_LINES = 300;
/** Options kept per line (the match + runners-up); the view shows at most 3. */
const TRACE_MAX_OPTIONS = 4;

const cut = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

export interface TraceLine {
  position: string;
  name: string;
  code: string;
  quantity: number | null;
  unit: string;
  kind: string;
  specs: string;
}

export interface TraceOption {
  name: string;
  code: string;
  brand: string;
  percent: number;
  reason: string;
  part: string;
  /** Price rows found for it, and how: an exact code hit or the judge's. */
  prices: number;
  exact: boolean;
}

export interface TraceMatchLine {
  line: TraceLine;
  /** [0] is the match, the rest its runners-up, best first; [] = no match. */
  options: TraceOption[];
  noMatchReason: string;
  partsNotFound: string[];
}

export interface PricingTraceBase {
  agent: "pricing";
  /** sebtember's status when the stage ended: `awaiting_confirmation`, `complete` or `error`. */
  status: string;
  error: string | null;
  sourceFilename: string;
}

export interface ExtractTrace extends PricingTraceBase {
  stage: "extract";
  /** Lines the file held before the cap, and the lines the read returned. */
  totalCount: number;
  read: number;
  capped: boolean;
  missingPositions: number;
  shortfall: { expected: number; got: number } | null;
  stoppedEarly: boolean;
  lines: TraceLine[];
  linesCut: number;
}

/** What the user did with a finished match: the lines whose ticks differ from the default, and exports. */
export interface PricingChoice {
  /** result line index → the option indices left ticked (`[]` = the line dropped). */
  changed: Record<string, number[]>;
  exported: string[];
}

export interface MatchTrace extends PricingTraceBase {
  stage: "match";
  requested: number;
  processed: number;
  cancelled: boolean;
  /** Lines the read returned that were not matched: unticked by the user, or not listed (no quantity). */
  untickedBeforeMatch: number;
  lines: TraceMatchLine[];
  linesCut: number;
  /** Absent until the user changes a tick or exports (written by `recordPricingChoice`). */
  choice?: PricingChoice & { at?: unknown };
}

export type PricingTrace = ExtractTrace | MatchTrace;

function traceLine(s: MoiSourceItem | undefined): TraceLine {
  return {
    position: cut(s?.position, 20),
    name: cut(s?.name, 200),
    code: cut(s?.code, 60),
    quantity: typeof s?.quantity === "number" ? s.quantity : null,
    unit: cut(s?.unit, 20),
    kind: cut(s?.kind, 20) || "product",
    specs: cut(s?.specs, 200),
  };
}

function base(run: Record<string, unknown>): PricingTraceBase {
  return {
    agent: "pricing",
    status: cut(run.status, 40),
    error: typeof run.error === "string" ? run.error.slice(0, 300) : null,
    sourceFilename: cut(run.source_filename, 200),
  };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function extractTrace(run: Record<string, unknown>): ExtractTrace {
  const items = (Array.isArray(run.items) ? run.items : []) as MoiSourceItem[];
  const g = (run.gather ?? {}) as Record<string, unknown>;
  const shortfall = (run.gather_shortfall ?? g.shortfall) as
    | { expected?: number; got?: number }
    | null
    | undefined;
  return {
    ...base(run),
    stage: "extract",
    totalCount: num(run.total_count) || items.length,
    read: items.length,
    capped: run.capped === true,
    missingPositions: num(run.gather_missing_positions ?? g.missing_positions),
    shortfall:
      shortfall && typeof shortfall === "object"
        ? { expected: num(shortfall.expected), got: num(shortfall.got) }
        : null,
    stoppedEarly: Boolean(run.gather_stopped_early ?? g.stopped_early),
    lines: items.slice(0, TRACE_MAX_LINES).map(traceLine),
    linesCut: Math.max(0, items.length - TRACE_MAX_LINES),
  };
}

export function matchTrace(run: Record<string, unknown>): MatchTrace {
  const result = (run.result ?? null) as IplResult | null;
  const items = result?.items ?? [];
  const read = Array.isArray(run.items) ? run.items.length : 0;
  const requested = Array.isArray(run.requested_indices) ? run.requested_indices.length : read;
  return {
    ...base(run),
    stage: "match",
    requested: result?.requested_count ?? requested,
    processed: result?.processed_count ?? items.length,
    cancelled: result?.cancelled === true,
    untickedBeforeMatch: Math.max(0, read - requested),
    lines: items.slice(0, TRACE_MAX_LINES).map((it) => ({
      line: traceLine(it.source),
      options: (it.match
        ? [{ match: it.match, prices: it.prices }, ...(it.alternatives ?? [])]
        : []
      )
        .slice(0, TRACE_MAX_OPTIONS)
        .map(({ match: o, prices }) => ({
          name: cut(o?.name, 160),
          code: cut(o?.code, 60),
          brand: cut(o?.brand, 60),
          percent: num(o?.percent),
          reason: cut(o?.reason, 240),
          part: cut(o?.part, 60),
          prices: Array.isArray(prices) ? prices.length : 0,
          exact: Array.isArray(prices) && prices.some((p) => p.confidence === "exact"),
        })),
      noMatchReason: cut(it.noMatchReason, 40),
      partsNotFound: (it.partsNotFound ?? []).slice(0, 6).map((p) => cut(p, 60)),
    })),
    linesCut: Math.max(0, items.length - TRACE_MAX_LINES),
  };
}

/**
 * The lines whose ticks differ from `defaults` (the page's first render): what the user corrected.
 * Lines left as they were are omitted, so an untouched run is `{}`.
 */
export function choiceOf(
  defaults: ReadonlyMap<number, ReadonlySet<number>>,
  selected: ReadonlyMap<number, ReadonlySet<number>>,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const i of new Set([...defaults.keys(), ...selected.keys()])) {
    const a = defaults.get(i) ?? new Set<number>();
    const b = selected.get(i) ?? new Set<number>();
    if (a.size !== b.size || [...a].some((x) => !b.has(x))) out[String(i)] = [...b].sort();
  }
  return out;
}

const EXPORTS = ["sheet", "pdf", "docx"] as const;

/** The browser's choice, read defensively: line indices < 1000, option indices < 10. */
export function parseChoice(raw: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 1000)) {
    if (!/^\d{1,3}$/.test(k) || !Array.isArray(v)) continue;
    out[k] = [...new Set(v.filter((n) => Number.isInteger(n) && n >= 0 && n < 10))].slice(0, 10);
  }
  return out;
}

export function parseExport(raw: unknown): string | null {
  return EXPORTS.includes(raw as (typeof EXPORTS)[number]) ? (raw as string) : null;
}
