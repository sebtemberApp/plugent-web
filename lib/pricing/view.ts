/**
 * The Pricing page's state, from sebtember's `pricing/get` answer. Client-safe.
 *
 * Sebtember's page builds the same `PricingInitial` from its Firestore document; here the answer
 * carries those fields under their own names, so the SAME readers (`readPricingCoverage`,
 * `readGatherProgress`, `readRequestedIndices`, copied from sebtember) parse it. Sebtember's
 * answer nests the gather's report under `gather`; it is flattened back to the document's names
 * before the readers see it.
 */
import type { IplResult } from "@/lib/agents/ipl/types";
import type { MoiSourceItem } from "@/lib/agents/moi/types";
import {
  type GatherProgress,
  type PricingCoverage,
  readGatherProgress,
  readPricingCoverage,
  readRequestedIndices,
} from "@/lib/pricing/confirm";

export type PricingStatus =
  | "draft"
  | "extracting"
  | "awaiting_confirmation"
  | "matching"
  | "complete"
  | "error";

/** Whose price lists priced the run: `isSelf` = the user's own (shown as "You"). */
export interface PricingOwner {
  name: string;
  isSelf: boolean;
}

export interface PricingInitial {
  title: string;
  status: PricingStatus;
  sourceFilename: string;
  sourceItems: MoiSourceItem[];
  capped: boolean;
  itemsSizeCut: number;
  coverage: PricingCoverage;
  requestedIndices: number[] | null;
  gatherProgress: GatherProgress | null;
  gatherStartedAtMs: number | null;
  result: IplResult | null;
  contentOwners: PricingOwner[];
  tokensUsed: number;
  error: string | null;
  progress: { done: number; total: number; current: string } | null;
  createdAtMs: number | null;
  matchingStartedAtMs: number | null;
  continueNeeded: boolean;
  discountClient: string | null;
}

/** The answer as it arrives: a record, read defensively (it is data, not a promise). */
export type PricingRunData = Record<string, unknown>;

const STATUSES: PricingStatus[] = [
  "draft",
  "extracting",
  "awaiting_confirmation",
  "matching",
  "complete",
  "error",
];

function isItem(v: unknown): v is MoiSourceItem {
  return typeof v === "object" && v !== null && typeof (v as MoiSourceItem).name === "string";
}

function readResult(raw: unknown): IplResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  return Array.isArray((raw as { items?: unknown }).items) ? (raw as IplResult) : null;
}

const ms = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);

/** A fresh page: nothing uploaded yet. */
export const BLANK_PRICING: PricingInitial = pricingInitial({ status: "draft" });

export function pricingInitial(d: PricingRunData): PricingInitial {
  const g = (d.gather ?? {}) as Record<string, unknown>;
  const flat: Record<string, unknown> = {
    ...d,
    gather_coverage: d.gather_coverage ?? g.coverage,
    gather_shortfall: d.gather_shortfall ?? g.shortfall,
    gather_position_gaps: d.gather_position_gaps ?? g.position_gaps,
    gather_missing_positions: d.gather_missing_positions ?? g.missing_positions,
    gather_stopped_early: d.gather_stopped_early ?? g.stopped_early,
    gather_progress: d.gather_progress ?? g.progress,
  };
  const items = Array.isArray(d.items) ? d.items.filter(isItem) : [];
  const p = d.ipl_progress as { done?: number; total?: number; current?: string } | undefined;
  const status = STATUSES.includes(d.status as PricingStatus)
    ? (d.status as PricingStatus)
    : "draft";
  return {
    title: typeof d.title === "string" ? d.title : "",
    status,
    sourceFilename: typeof d.source_filename === "string" ? d.source_filename : "",
    sourceItems: items,
    capped: d.capped === true,
    itemsSizeCut: typeof d.items_size_cut === "number" ? d.items_size_cut : 0,
    coverage: readPricingCoverage(flat, items.length),
    requestedIndices: readRequestedIndices(flat),
    gatherProgress: readGatherProgress(flat),
    gatherStartedAtMs: ms(d.gather_started_at_ms),
    result: readResult(d.result),
    contentOwners: Array.isArray(d.contentOwners)
      ? (d.contentOwners as unknown[]).flatMap((o) => {
          const r = o as { name?: unknown; isSelf?: unknown };
          return typeof r?.name === "string" ? [{ name: r.name, isSelf: r.isSelf === true }] : [];
        })
      : [],
    tokensUsed: typeof d.tokensUsed === "number" && d.tokensUsed > 0 ? d.tokensUsed : 0,
    error: typeof d.error === "string" ? d.error : null,
    progress:
      typeof p === "object" && p !== null
        ? {
            done: typeof p.done === "number" ? p.done : 0,
            total: typeof p.total === "number" ? p.total : 0,
            current: typeof p.current === "string" ? p.current : "",
          }
        : null,
    createdAtMs: ms(d.created_at_ms),
    matchingStartedAtMs: ms(d.matching_started_at_ms),
    continueNeeded: d.continue_needed === true,
    discountClient: typeof d.discount_client === "string" ? d.discount_client : null,
  };
}
