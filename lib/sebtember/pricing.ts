/**
 * Plugent → sebtember's Pricing product API (`/api/products/pricing/*`).
 *
 * The engine, the price lists and the discount tables stay in Sebtember; Plugent shows the steps.
 * The contract is the project file `plugent/pricing-api.md` (requested 2026-10-28), mirrored in
 * `docs/sebtember-api.md`.
 *
 * ⚠️ SEBTEMBER CHARGES ITS OWN ENGINE WORK (the read, the identity search, the judge) to the
 * `source` the balance call returned, as product lines carrying their model usage. Plugent runs
 * no model of its own for Pricing, so it charges nothing; it records what each step returned.
 */
import "server-only";
import type { DiscountClient, DiscountTableView } from "@/lib/agents/ipl/discount";
import type { IplResult } from "@/lib/agents/ipl/types";
import type { MoiSourceItem } from "@/lib/agents/moi/types";
import { type ChargeUsage, post, postForFile } from "@/lib/sebtember/products";

export type PricingStatus =
  | "draft"
  | "extracting"
  | "awaiting_confirmation"
  | "matching"
  | "complete"
  | "error";

/** What one step charged, as sebtember reports it. */
export interface PricingCharge {
  tokens: number;
  duplicate: boolean;
  usage?: ChargeUsage[];
}

/** `pricing/get` — the whole run. Fields keep sebtember's names (IPL's, CLAUDE.md there). */
export interface PricingRun {
  pricing_id: string;
  status: PricingStatus;
  title: string;
  source_filename: string;
  items: MoiSourceItem[];
  total_count: number;
  capped: boolean;
  items_size_cut?: number;
  requested_indices?: number[] | null;
  gather_progress?: { phase: string; done: number; total: number; unit: string } | null;
  gather_started_at_ms?: number | null;
  ipl_progress?: { done: number; total: number; current: string } | null;
  matching_started_at_ms?: number | null;
  /** The gather's coverage report and shortfall signals, verbatim (`readPricingCoverage` reads them). */
  gather_coverage?: unknown;
  gather_shortfall?: unknown;
  gather_position_gaps?: unknown;
  gather_missing_positions?: number;
  gather_stopped_early?: unknown;
  /** COMPLETE: every price list; Plugent filters at view time, as sebtember does. */
  result: IplResult | null;
  contentOwners?: Array<{ name: string | null; isSelf: boolean }>;
  tokensUsed: number;
  error?: string | null;
  continue_needed?: boolean;
  discount_client?: string | null;
  /** `loadDiscountMatrices`: names and the one resolved row, never every client's percentages. */
  discount?: DiscountTableView | null;
}

export interface PricingStepResult extends PricingRun {
  charged?: PricingCharge;
  balanceAfter?: number | null;
  /** The charged lines' model usage — sebtember sends it BESIDE `charged`, not inside it. */
  usage?: ChargeUsage[];
}

export interface PricingUpload {
  pricing_id: string;
  upload: { url: string; method: "PUT"; headers: Record<string, string> };
}

export function startPricing(
  uid: string,
  file: { filename: string; mime_type: string; size_bytes: number },
): Promise<PricingUpload> {
  return post<PricingUpload>("/api/products/pricing/start", { uid, ...file });
}

/**
 * A step (extract, match) runs on sebtember for up to its own 300 s; Plugent waits 270 s, so the
 * route still has time to keep the step's charge as a turn when sebtember answers late.
 */
const PRICING_STEP_TIMEOUT_MS = 270_000;

export function extractPricing(
  uid: string,
  source: string,
  pricingId: string,
  requestId: string,
): Promise<PricingStepResult> {
  return post<PricingStepResult>(
    "/api/products/pricing/extract",
    {
      uid,
      source,
      pricing_id: pricingId,
      request_id: requestId,
    },
    { timeoutMs: PRICING_STEP_TIMEOUT_MS },
  );
}

export function matchPricing(
  uid: string,
  source: string,
  pricingId: string,
  requestId: string,
  keep: number[] | undefined,
  continuation?: number,
): Promise<PricingStepResult> {
  return post<PricingStepResult>(
    "/api/products/pricing/match",
    {
      uid,
      source,
      pricing_id: pricingId,
      request_id: requestId,
      ...(keep ? { keep } : {}),
      ...(continuation ? { continue: continuation } : {}),
    },
    { timeoutMs: PRICING_STEP_TIMEOUT_MS },
  );
}

export function getPricing(uid: string, pricingId: string, rescan = false): Promise<PricingRun> {
  return post<PricingRun>("/api/products/pricing/get", {
    uid,
    pricing_id: pricingId,
    ...(rescan ? { rescan: true } : {}),
  });
}

export type DiscountClientAnswer =
  | { kind: "match"; name: string; client: DiscountClient; sourceFile: string }
  | { kind: "ambiguous" | "none" | "short"; candidates: string[] }
  | { kind: "cleared" };

export function setPricingDiscountClient(
  uid: string,
  pricingId: string,
  typed: string | null,
): Promise<DiscountClientAnswer> {
  return post<DiscountClientAnswer>("/api/products/pricing/discount-client", {
    uid,
    pricing_id: pricingId,
    typed,
  });
}

export function cancelPricing(uid: string, pricingId: string, force: boolean): Promise<PricingRun> {
  return post<PricingRun>("/api/products/pricing/cancel", {
    uid,
    pricing_id: pricingId,
    ...(force ? { force: true } : {}),
  });
}

export function pricingDocument(
  uid: string,
  pricingId: string,
  templateId: "default-pdf" | "default-docx",
  selected: Record<number, number[]>,
  client: string | null,
) {
  return postForFile("/api/products/pricing/document", {
    uid,
    pricing_id: pricingId,
    template_id: templateId,
    selected,
    client,
  });
}

export function deletePricing(uid: string, pricingId: string): Promise<{ ok: true }> {
  return post<{ ok: true }>("/api/products/pricing/delete", { uid, pricing_id: pricingId });
}
