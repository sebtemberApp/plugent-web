/**
 * POST /api/agents/pricing — the Pricing agent's one door. Body `{action, runId?, …}`; every action
 * runs on sebtember's engine through `lib/sebtember/pricing.ts`, for the session's user only.
 *
 *   start     {filename, mimeType, size}  → {runId, upload}: the run, and where the browser PUTs the file
 *   extract   {runId}                     → the run after the read (stage 1)
 *   match     {runId, keep?, requestId?, continue?} → the run after identification (stage 2)
 *   get       {runId, rescan?}            → the run (polled while a step runs)
 *   discount  {runId, typed}              → the client name resolved against the table (null clears)
 *   cancel    {runId, force?}             → the run
 *   document  {runId, templateId, selected, client} → the priced list as a PDF / Word file
 *   choice    {runId, changed?, exported?}   → {ok}: what the user did with the match (the review's signal)
 *
 * ⚠️ THE WALLET IS THE ONE THE BALANCE CALL RETURNED AT START, stored on the run and passed back
 * with every paid step; never re-resolved. Sebtember charges its engine work to it; each charge it
 * reports is kept as a turn with its model usage.
 *
 * ⚠️ EACH STAGE'S END IS KEPT AS A TRACE (`lib/review/pricing-trace.ts`, 30 days, server-only) for the
 * two-weekly Pricing review (`docs/pricing-loop.md`): whichever answer first shows the stage ended —
 * the step's own, or a poll — writes it, once. A failed trace never fails the answer.
 */
import { type NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { readPrefs } from "@/lib/prefs";
import { consumeRateLimit } from "@/lib/rate-limit";
import { extractTrace, matchTrace, parseChoice, parseExport } from "@/lib/review/pricing-trace";
import {
  claimPricingMatch,
  createPricingRun,
  isRunId,
  type PricingRunState,
  readPricingRun,
  recordPricingCharge,
  recordPricingChoice,
  releasePricingMatch,
  savePricingTrace,
  touchRun,
} from "@/lib/runs";
import {
  cancelPricing,
  extractPricing,
  getPricing,
  matchPricing,
  type PricingStepResult,
  pricingDocument,
  setPricingDiscountClient,
  startPricing,
} from "@/lib/sebtember/pricing";
import { getBalance, SebtemberApiError } from "@/lib/sebtember/products";

export const runtime = "nodejs";
/** Stage 2 runs up to sebtember's own 300 s ceiling; the wait is here. */
export const maxDuration = 300;

/** The upload limits sebtember's `moi-uploads` storage rule sets (its Step 1159). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_KEEP = 1000;

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/** A step's charge, kept on the run. A duplicate (a retry sebtember already charged) is not. */
async function keepCharge(
  uid: string,
  runId: string,
  step: "extract" | "match",
  lineId: string,
  result: PricingStepResult,
) {
  const c = result.charged;
  if (!c || c.tokens <= 0 || c.duplicate) return;
  const usage = result.usage ?? c.usage;
  await recordPricingCharge(uid, runId, step, lineId, { tokens: c.tokens, usage }).catch((err) =>
    console.error(`[pricing] charge record failed run=${runId} line=${lineId}`, err),
  );
}

/**
 * The stage's trace, when this answer is the first to show the stage ended. A read ends at
 * `awaiting_confirmation` (or `error` before any match), keyed by when it started, so "Start over"
 * keeps a second one; a match ends at `complete` (or `error`), keyed by its request id.
 */
async function keepTrace(
  uid: string,
  runId: string,
  run: PricingRunState,
  answer: Record<string, unknown>,
  requestId = run.matchRequestId,
) {
  const status = answer.status;
  const matched = status === "complete" || (status === "error" && requestId);
  const read = status === "awaiting_confirmation" || (status === "error" && !requestId);
  try {
    if (matched && requestId && run.tracedMatch !== requestId) {
      await savePricingTrace(uid, runId, requestId, matchTrace(answer));
    } else if (read) {
      const key = `${runId}-${Number(answer.gather_started_at_ms) || 0}`;
      if (run.tracedExtract !== key) await savePricingTrace(uid, runId, key, extractTrace(answer));
    }
  } catch (err) {
    console.error(`[pricing] trace failed run=${runId}`, err);
  }
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return bad("unauthorized", 401);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return bad("invalid_request");
  const action = String(body.action ?? "");
  const uid = user.uid;

  const paid = action === "start" || action === "extract" || action === "match";
  if (paid) {
    // Turned off on All agents: refused before any money is spent. A failed read refuses too.
    const prefs = await readPrefs(uid).catch((err) => {
      console.error("[pricing] prefs read failed", err);
      return null;
    });
    if (!prefs) return bad("unavailable", 503);
    if (prefs.disabledAgents.includes("pricing")) return bad("agent_off", 403);
    // Every paid step counts against the agents' limit, not only `start`: a read or a match
    // (or a replayed one) is sebtember engine work charged to the wallet.
    if (action !== "start" && !(await consumeRateLimit(uid, "agents"))) {
      return bad("rate_limited", 429);
    }
  }

  try {
    if (action === "start") {
      const filename = typeof body.filename === "string" ? body.filename.trim().slice(0, 200) : "";
      const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
      const size = Number(body.size);
      if (!filename || !mimeType || !Number.isInteger(size) || size <= 0) {
        return bad("invalid_file");
      }
      if (size > (mimeType.startsWith("image/") ? MAX_IMAGE_BYTES : MAX_FILE_BYTES)) {
        return bad("too_large", 413);
      }
      // A new pricing counts against the agents' rate limit; its later steps continue it.
      if (!(await consumeRateLimit(uid, "agents"))) return bad("rate_limited", 429);
      const wallet = await getBalance(uid);
      if (wallet.balance < wallet.minimum) return bad("low_balance", 402);
      const started = await startPricing(uid, {
        filename,
        mime_type: mimeType,
        size_bytes: size,
      });
      const runId = await createPricingRun(uid, {
        title: filename,
        pricingId: started.pricing_id,
        source: wallet.source,
      });
      return NextResponse.json({ runId, upload: started.upload });
    }

    const runId = String(body.runId ?? "");
    if (!isRunId(runId)) return bad("run_not_found", 404);
    const run = await readPricingRun(uid, runId);
    if (!run) return bad("run_not_found", 404);

    switch (action) {
      case "get": {
        const answer = await getPricing(uid, run.pricingId, body.rescan === true);
        await keepTrace(uid, runId, run, answer as unknown as Record<string, unknown>);
        return NextResponse.json(answer);
      }

      case "extract": {
        // One read per run: the run id IS the request id, so a retried read is charged once.
        const result = await extractPricing(uid, run.source, run.pricingId, runId);
        await keepCharge(uid, runId, "extract", `${runId}-extract`, result);
        await keepTrace(uid, runId, run, result as unknown as Record<string, unknown>);
        return NextResponse.json(result);
      }

      case "match": {
        const keep = Array.isArray(body.keep)
          ? body.keep
              .filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0)
              .slice(0, MAX_KEEP)
          : undefined;
        // ⚠️ The request id and the continuation number are the SERVER's (`claimPricingMatch`): a
        // new match (Next, Refresh) mints one, a continuation takes the run's stored id and next
        // number. The browser's `requestId` / `continue` value is never trusted.
        const claim = await claimPricingMatch(
          uid,
          runId,
          Number(body.continue) > 0 ? "continue" : "new",
        );
        if (claim === "busy") return bad("busy", 409);
        if (claim === "no_match") return bad("no_match", 409);
        const { requestId, n: cont } = claim;
        let result: PricingStepResult;
        try {
          result = await matchPricing(uid, run.source, run.pricingId, requestId, keep, cont);
        } catch (err) {
          await releasePricingMatch(uid, runId, claim, true).catch(() => {});
          throw err;
        }
        await releasePricingMatch(uid, runId, claim, false).catch(() => {});
        await keepCharge(uid, runId, "match", `${requestId}-match-${cont}`, result);
        await keepTrace(uid, runId, run, result as unknown as Record<string, unknown>, requestId);
        await touchRun(uid, runId).catch(() => {});
        return NextResponse.json({ ...result, requestId });
      }

      case "discount": {
        const typed = body.typed === null ? null : String(body.typed ?? "").slice(0, 200);
        return NextResponse.json(await setPricingDiscountClient(uid, run.pricingId, typed));
      }

      case "cancel":
        return NextResponse.json(await cancelPricing(uid, run.pricingId, body.force === true));

      case "document": {
        const templateId = body.templateId === "default-docx" ? "default-docx" : "default-pdf";
        const selected: Record<number, number[]> = {};
        if (body.selected && typeof body.selected === "object") {
          for (const [k, v] of Object.entries(body.selected as Record<string, unknown>)) {
            if (/^\d+$/.test(k) && Array.isArray(v)) {
              selected[Number(k)] = v.filter((n) => Number.isInteger(n) && n >= 0) as number[];
            }
          }
        }
        const client = typeof body.client === "string" ? body.client.slice(0, 200) : null;
        const file = await pricingDocument(uid, run.pricingId, templateId, selected, client);
        await recordPricingChoice(uid, run, runId, {
          exported: templateId === "default-docx" ? "docx" : "pdf",
        }).catch((err) => console.error(`[pricing] choice failed run=${runId}`, err));
        return new NextResponse(file.bytes, {
          headers: {
            "content-type": file.contentType,
            ...(file.disposition ? { "content-disposition": file.disposition } : {}),
          },
        });
      }

      case "choice": {
        // Evidence only: what the user ticked, never a price. Free, like `get`.
        const exported = parseExport(body.exported);
        await recordPricingChoice(uid, run, runId, {
          ...(body.changed !== undefined ? { changed: parseChoice(body.changed) } : {}),
          exported,
        }).catch((err) => console.error(`[pricing] choice failed run=${runId}`, err));
        return NextResponse.json({ ok: true });
      }

      default:
        return bad("invalid_request");
    }
  } catch (err) {
    if (err instanceof SebtemberApiError) {
      // Sebtember's own refusals pass through by code; anything else is its outage.
      const passthrough = [400, 402, 403, 404, 409, 413, 429];
      if (passthrough.includes(err.status)) return bad(err.code, err.status);
      console.error(`[pricing] ${action} sebtember ${err.status} ${err.code}`);
      return bad("unavailable", 502);
    }
    console.error(`[pricing] ${action} failed`, err);
    return bad("failed", 500);
  }
}
