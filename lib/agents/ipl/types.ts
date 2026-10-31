/**
 * IPL (Item Price List) — shared types + constants. PR 1 of 4.
 *
 * The job: a user uploads a GENERIC list of materials ("circulation pump DN50",
 * "cable 3x2.5mm2") and gets back a priced list of SPECIFIC models, with one
 * column per price list the prices were found in.
 *
 * Two stages, and the split is the whole point:
 *
 *   1. IDENTITY  generic line -> a specific model in the user's catalogues.
 *                Best evidence is descriptive: datasheets, catalogues, specs.
 *   2. PRICE     that model's code -> its price rows.
 *                Best evidence is terse: `Code: X | Description: Y | Price EUR: 249.00`.
 *
 * Matching a generic line straight against a terse price row is the worst case —
 * least information on both sides. Resolving identity first makes stage 2
 * code-to-code, which is near-exact and usually needs no model call at all.
 *
 * IPL vs MOI: MOI answers "what in my catalogues is like this?" and shows
 * alternatives with confidence. IPL answers "what does this list cost?" and is
 * strictly ONE row per input line. Stage 1 is literally MOI's pipeline —
 * `extract.ts` + `match.ts` are imported, not forked.
 *
 * PR 1 ships stages 1 only; `prices` is always empty. The shape is final from
 * the start so PR 2 is purely additive.
 *
 * Pure types + constants — no imports beyond a type, no env reads — so client
 * and server can both import freely.
 */
import type { MoiNoCandidateReason, MoiSourceItem } from "@/lib/agents/moi/types";

export type { MoiSourceItem as IplSourceItem };

/**
 * ONE price for a matched item, found in ONE of the user's documents.
 *
 * `sourceFile` is load-bearing: the result's price COLUMNS are simply the
 * distinct source files that yielded a price. Nothing classifies a document as
 * "a price list" — the columns emerge from what actually produced prices, which
 * is both simpler and more honest than a classifier that can be wrong.
 */
export interface IplPrice {
  /** The document this price came from. Becomes a column. */
  sourceFile: string;
  /** The parsed numeric value. */
  value: number;
  /** Currency as written in the source ("EUR", "$"), or "" when unstated. */
  currency: string;
  /**
   * The source column's OWN header, verbatim — "Price EUR", "Net", "Gross incl.
   * VAT", "Kaina".
   *
   * Never dropped, and never normalised away. A price list routinely carries net
   * AND gross (the extraction eval has a merged-cell fixture with `Price (EUR)`
   * spanning both, precisely because it is the hard case), so a bare number is
   * ambiguous exactly where being wrong is most expensive: this output ends up
   * in a customer quote.
   */
  label: string;
  /** Per-unit / quantity-tier qualifier when the row carries one ("per m", "10+"). */
  unit: string;
  /** How it was found — an exact code hit, or an LLM fallback when none matched. */
  confidence: "exact" | "judged";
  /**
   * Step 1104 — the DISCOUNT GROUP the price row refers to (`Nuolaidos grupė:
   * 1771_4`), captured when the row is read so the Price step can look it up
   * against a client's row of the discount table at VIEW time.
   *
   * ⚠️ OPTIONAL, and absent on every run written before this step — which the
   * surface reports as "no discount group on this price", never as a discount
   * of 0%. Also absent when the price list carries no such column (Elterm).
   */
  discountGroup?: string;
  /**
   * Step 1153 — the price row's OWN description of the product, verbatim
   * (`Pavadinimas: Cirkuliacinis siurblys Wilo Yonos MAXO 25/0,5-12 PN10`).
   *
   * The Match step names a line by the document that established its IDENTITY
   * (a datasheet, a catalogue — `IplMatch.name`); the price then comes from a
   * PRICE LIST row, which describes the same article in the supplier's own
   * words — the words on the supplier's order form. Operator: "the Match step
   * finds items price, also it can take original item name from the pricelist.
   * Take the original item name for xls export." Read by `readRowFields` (the
   * Step-1129 reader: a name-labelled cell, else the longest prose cell).
   *
   * ⚠️ OPTIONAL: absent on every run before this step, on a sheet-level chunk
   * (its first name cell belongs to some other product — the `discountGroup`
   * rule), and on a row with no name cell. Rendered as "" and never invented.
   */
  itemName?: string;
}

/** The SINGLE best match for an input line. One-to-one by design: no alternatives. */
export interface IplMatch {
  name: string;
  code: string;
  /**
   * Step 1085 — the four things a buyer needs to act on a row: a SHORT name, the
   * code, the BRAND and the score. Step 840 added both to `MoiCandidate` for
   * exactly that reason and the IPL mapper dropped them, so a priced row could
   * name a product without saying who makes it.
   *
   * ⚠️ OPTIONAL, and absent on every run written before this step — the surface
   * must render a row without them rather than print "undefined".
   */
  shortName?: string;
  brand?: string;
  /**
   * 0–100 from the judge. ⚠️ Step 1118 — NO LONGER SHOWN and no longer a
   * confidence signal: the operator removed the confidence floor and the score
   * from the card entirely ("a match is a match"). It survives as INTERNAL
   * DATA only — `optionIsWorthShowing` ranks and filters the runner-up options
   * by it (a 5% match is noise, a 45% one is a real alternative), which is a
   * DISPLAY-COUNT decision, not the confidence gate that used to hold a priced
   * row out of the total.
   */
  percent: number;
  /** One-line rationale in the runner's language (preview only). */
  reason: string;
  /** Which of the user's documents identified this model. */
  sourceFile: string;
  /**
   * Step 1126 — on a COMPOSITE line (`RWM10.0N1E + RAS-10WHNPE`, one set), the
   * part of the source code this option answers. A part is a REQUIRED PIECE of
   * the item, not a runner-up: it is always shown (exempt from the Step-1088
   * display bar and the option cap), ticked by default like every priced
   * option, and a line whose ticked options are all parts is NOT "counted more
   * than once" — the set's price is the sum of its parts. Absent on every
   * single-product line and on every run before this step.
   */
  part?: string;
}

/**
 * Step 1085 — ONE matched product together with the prices found for its code.
 *
 * ⚠️ THE PRICES BELONG TO THE MATCH, NOT THE LINE. A line can now carry
 * several candidate products, and each is priced under its OWN code — so a
 * single `prices` array on the item cannot say which product a number
 * belongs to. The item keeps its own `match`/`prices` pair unchanged (see
 * below); this shape carries the runners-up.
 */
export interface IplPricedMatch {
  match: IplMatch;
  prices: IplPrice[];
}

/** One input line -> its single best match -> every price found for it. */
export interface IplResultItem {
  source: MoiSourceItem;
  /** null = honest "no match" (nothing cleared the floor at all). */
  match: IplMatch | null;
  /**
   * Step 1033 — WHY there is no match, when there is none.
   *
   * ⚠️ MOI HAS RECORDED THIS SINCE STEP 847 AND IPL THREW IT AWAY. `toIplItems`
   * mapped `MoiResultItem` to this shape and kept only `candidates`, so a line
   * retrieval never managed to search rendered identically to a line the
   * corpus genuinely lacks — and on the operator's tender ten lines came back
   * unsearched, including a valve whose four sibling sizes matched at 85%.
   * "We could not look" is not "not stocked", and only one of them is ours to
   * fix.
   *
   * ⚠️ ABSENT DOES NOT MEAN "scored zero". It also means "this run predates
   * Step 1033", so the surface must fall back to the neutral wording that is
   * true either way — see `noMatchKind`.
   */
  noMatchReason?: MoiNoCandidateReason;
  /**
   * Step 1126 — on a composite line, the parts of the code that matched
   * NOTHING (no candidate scored above 0), in the code's order. The parts that
   * did match are `match` + `alternatives`, each tagged `part`; this is the
   * rest, so the card and the sheet can say "RWM10.0N1E — not found" instead
   * of silently quoting half a set. Omitted when every part matched and on
   * every run before this step.
   */
  partsNotFound?: string[];
  /**
   * ALL prices from ALL documents, unfiltered.
   *
   * Stored complete and narrowed at VIEW time — the same reason MOI keeps every
   * scored candidate: the expensive work is the run, so letting the user toggle
   * price lists on and off costs nothing and needs no re-run. It also means the
   * user chooses which lists matter AFTER seeing the actual prices, instead of
   * picking blind from filenames before anything has happened.
   *
   * Always [] in PR 1.
   */
  prices: IplPrice[];
  /**
   * Step 1085 — the RUNNERS-UP, each with its own prices. Best-first.
   *
   * ⚠️ ADDITIVE, and `match`/`prices` above are deliberately UNCHANGED. Every
   * existing reader — `matchTier`, `pricesFor`, `priceColumns`,
   * `summariseColumn`, the export — goes through those, and every stored run
   * has them. Nothing migrates (the Step-1051 rule), so a run written before
   * this step must render exactly as it did: absent means "one match, as
   * before", never "no alternatives were found".
   *
   * ⚠️ EXCLUDES the best — it is `match`. Storing it twice would double it in
   * any surface that walks both.
   *
   * ⚠️ STORED WHOLE, FILTERED AT VIEW TIME, like `prices` itself. Which
   * runners-up are worth SHOWING is a threshold nobody has measured — the
   * scores of non-winning candidates have never been stored, so there is no
   * distribution to calibrate against. Keeping them all makes that threshold
   * re-tunable without re-running, and the next real run supplies the data.
   */
  alternatives?: IplPricedMatch[];
}

/** The full structured result stored on the run doc (language-neutral). */
export interface IplResult {
  items: IplResultItem[];
  /** Lines found in the file before the cap. */
  total_count: number;
  /** Lines actually matched (<= cap). */
  processed_count: number;
  /**
   * Step 815 — lines this run SET OUT to process, i.e. the confirmed source
   * list. The coverage denominator, and deliberately NOT `total_count` (which
   * counts what the file held BEFORE the item cap, so it can exceed anything
   * this run ever looked at) nor `items.length` (which is what it MANAGED to
   * process — using that as the denominator is what let a cancelled run report
   * "8/8 priced" on a 50-line list).
   *
   * Optional: results written before Step 815 don't carry it, and those fall
   * back to `items.length` — the pre-815 behaviour, correct for the complete
   * runs that are the overwhelming majority of stored results.
   */
  requested_count?: number;
  /**
   * Step 815 — TRUE when the user cancelled mid-run, so this result covers only
   * part of the list. Was computed and returned to the client but never
   * persisted, while the run doc was written `status: "complete"`
   * unconditionally — so on reload a cancelled run was indistinguishable from a
   * finished one, and its totals read as full coverage.
   */
  cancelled?: boolean;
  capped: boolean;
  /**
   * ⚠️ Step 1118 — the confidence-floor snapshot, RETIRED. The floor is gone
   * (a match is a match), so nothing reads this any more. Existing runs still
   * carry it; new runs do not write it. Left on the type as an optional inert
   * field rather than removed, so a historical result still parses.
   */
  run_min_confidence?: number;
  /** Runner's preferred_language (reason language + initial header language). */
  lang: string;
}

/** Run lifecycle on the agentRuns doc — mirrors MOI's extract -> confirm -> run. */
export type IplRunStatus =
  | "extracting"
  | "awaiting_confirmation"
  | "matching"
  | "complete"
  | "error"
  | "cancelled";

/*
 * ⚠️ Step 1118 — `IPL_DEFAULT_MIN_CONFIDENCE` (the confidence floor, was 50)
 * is REMOVED, by operator decision: "if there is a price for this item then
 * calculate it." A match is a match now — its price enters the total whatever
 * the judge's score, the "below floor" flag is gone, and the score is not
 * shown. This retires the round-1 audit F12 (the floor was its subject: it
 * was never calibrated, and there is now nothing to calibrate).
 *
 * The Step-734 exclusion this floor drove — a low-confidence price kept out of
 * the total — is the guard the operator reversed. It is recorded in
 * docs/pricing-history.md rather than the code, because the reason a total
 * excludes nothing is exactly the thing a future reader would otherwise
 * "restore" as a bug fix.
 */

/**
 * Step 1085 — how many matched products one line may carry, INCLUDING the best.
 *
 * The operator's spec: "display up to three positions for the item".
 *
 * ⚠️ A RUN-TIME cap, unlike every other IPL threshold, and for a reason: each
 * stored match is priced, and pricing is Firestore queries — `findPrices`
 * batches 10 codes per query, so tripling the codes triples the batches. The
 * VIEW may still show fewer; it may not show more than was priced.
 */
export const IPL_MAX_MATCHES = 3;

/**
 * Step 1088 — the two DISPLAY rules, both the operator's own numbers.
 *
 * "I think that score below 20% is not worth of showing. If score difference
 * between candidates of one item bigger than 20% also not worth of showing."
 *
 * ⚠️ VIEW-TIME, like every other IPL threshold except `IPL_MAX_MATCHES` — the
 * run stores every match it priced, so changing these re-tunes a FINISHED run
 * without re-matching it. That is the standing IPL design (Step 724) and the
 * reason a threshold here is cheap to get wrong.
 *
 * ⚠️ Step 1118 — THESE ARE ALL THAT IS LEFT OF THE SCORE. The confidence floor
 * (`IPL_DEFAULT_MIN_CONFIDENCE`) that used to decide whether a shown option's
 * price entered the TOTAL is gone (a match is a match now), so these two are no
 * longer "a different question from the floor" — they are the ONLY question the
 * score still answers: is a runner-up option worth DISPLAYING at all. A 5%
 * alternative is noise; a 45% one is a real second option. This decides how
 * many candidates a line shows, never whether a price counts.
 *
 * ⚠️ MEASURED on the run that prompted them (`13 TS.pdf`, 90 lines): they drop
 * 13 options — and (before the floor was removed) not one was contributing to
 * the total. Now that every priced option counts, the gap rule CAN move money:
 * an option at 60 beside a best of 85 is across the gap, so dropping it drops
 * its price. It is a display rule with a monetary edge, not a cosmetic one.
 */
export const IPL_MIN_OPTION_PERCENT = 20;

/**
 * How far below the best SHOWN option a candidate may sit and still be offered.
 *
 * ⚠️ Measured against the best PRICED option, not the best match. The rule is
 * about candidates the user sees side by side, and an unpriced match is not one
 * of them — comparing against a match that never appears would hide options for
 * a reason invisible on screen.
 *
 * ⚠️ The comparison is `>`, so a gap of EXACTLY 20 is kept. That is the
 * operator's own example: 85% and 65% under one line, which they singled out as
 * the behaviour they wanted ("what I like is that function found two products
 * under one item").
 */
export const IPL_MAX_OPTION_GAP = 20;

/** Accepted source-file types — same inputs as MOI (docx / xlsx / pdf / csv / images). */
export { MOI_ACCEPT as IPL_ACCEPT } from "@/lib/agents/moi/types";
