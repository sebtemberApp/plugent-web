/**
 * The three discount calls sebtember's copied Pricing components (`DiscountPrompt`,
 * `use-discount-tables`) make, under the names and signatures they import from sebtember's
 * `lib/pricing/server.ts` — so those copies stay verbatim.
 *
 * ⚠️ NOT SERVER ACTIONS HERE: each is a fetch to Plugent's `/api/agents/pricing`, which asks
 * sebtember. `docId` is PLUGENT's run id; the route maps it to the sebtember pricing.
 */
import type { DiscountClient, DiscountTableView } from "@/lib/agents/ipl/discount";

async function pricingAction<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/agents/pricing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "failed");
  return data as T;
}

const NO_TABLE: DiscountTableView = { groups: [], clients: [], client: null, sourceFile: "" };

export async function loadDiscountMatrices(
  docId: string,
  opts: { rescan?: boolean } = {},
): Promise<DiscountTableView> {
  const run = await pricingAction<{ discount?: DiscountTableView | null }>({
    action: "get",
    runId: docId,
    ...(opts.rescan ? { rescan: true } : {}),
  });
  return run.discount ?? NO_TABLE;
}

export async function applyPricingDiscountClient(
  docId: string,
  typed: string,
): Promise<
  | { kind: "match"; name: string; client: DiscountClient; sourceFile: string }
  | { kind: "ambiguous" | "none" | "short"; candidates: string[] }
> {
  return pricingAction({ action: "discount", runId: docId, typed });
}

export async function setPricingDiscountClient(
  docId: string,
  client: string | null,
): Promise<{ ok: true }> {
  await pricingAction({ action: "discount", runId: docId, typed: client });
  return { ok: true };
}
