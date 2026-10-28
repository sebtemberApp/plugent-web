/**
 * IPL view-time derivation. PURE — types plus the pure price parser, no I/O.
 *
 * A run stores EVERYTHING it found: every scored candidate collapsed to a best
 * match, and (from PR 2) every price from every document. These functions turn
 * that into what the card and the export show, at VIEW time — so unchecking a
 * price list, or picking a discount client, re-renders instantly instead of
 * re-running a job that costs real tokens. (Step 1118 removed the confidence
 * floor that used to be the headline example of a view-time knob.)
 *
 * Same principle MOI established for its thresholds; the reason it matters more
 * here is that IPL's run is two stages, not one.
 */

import { isPriceHeader, normaliseCode } from "@/lib/agents/ipl/price-parse";
import type {
  IplMatch,
  IplPrice,
  IplPricedMatch,
  IplResult,
  IplResultItem,
} from "@/lib/agents/ipl/types";
import {
  IPL_MAX_MATCHES,
  IPL_MAX_OPTION_GAP,
  IPL_MIN_OPTION_PERCENT,
} from "@/lib/agents/ipl/types";
import type { MoiCandidate, MoiResultItem, MoiSourceItem } from "@/lib/agents/moi/types";

/**
 * Collapse MOI's scored candidates to IPL's single match.
 *
 * ⚠️ The one function here that runs at RUN time, not view time — the price
 * stage needs a code to look up, so the choice has to be made before pricing
 * rather than deferred to the card.
 *
 * It keeps the best candidate WHATEVER it scored, and returns null only when
 * there was nothing to choose from. ⚠️ Step 1118 — with the confidence floor
 * gone every kept match is a real match; dropping weak ones here would still be
 * wrong for the old reason (it bakes a threshold into the stored result and
 * throws away a row the user could eyeball), so the match is kept whatever it
 * scored, as before.
 */
export function pickBestMatch(candidates: MoiCandidate[]): IplMatch | null {
  let best: MoiCandidate | null = null;
  for (const c of candidates) {
    // Strictly greater, so an exact tie keeps the earlier (better-retrieved) one.
    if (!best || c.percent > best.percent) best = c;
  }
  if (!best || best.percent <= 0) return null;
  return {
    name: best.name,
    code: best.code,
    // Conditional spreads: Firestore rejects an `undefined` field value, and
    // these are absent on candidates from before Step 840.
    ...(best.shortName ? { shortName: best.shortName } : {}),
    ...(best.brand ? { brand: best.brand } : {}),
    percent: best.percent,
    reason: best.reason,
    sourceFile: best.sourceFile,
    // Step 1126 — the part of a composite code this answers; absent otherwise.
    ...(best.part ? { part: best.part } : {}),
  };
}

/**
 * Step 1085 — the top N distinct products for one line, best first.
 *
 * ⚠️ THE JUDGE ALREADY SCORED THESE AND THE MAPPER THREW THEM AWAY. Every
 * candidate carries a name, a code, a brand and a score (Step 840 added the
 * brand for exactly the row this feeds), and `toIplItems` kept only the
 * highest. Same class as Step 1033's `noCandidateReason`: a signal the run
 * already produced, discarded one layer before the surface that needed it.
 *
 * ⚠️ DEDUPED BY PRODUCT, and that is what makes alternatives meaningful rather
 * than decorative. Retrieval routinely returns the same product from two
 * chunks of one document, so an undeduped top-3 can be one product listed
 * three times — three rows asking the user to choose between identical
 * things. `pickBestMatch` never had to care, because taking a maximum is
 * blind to duplicates.
 *
 * ⚠️ CODE FIRST, NAME ONLY AS A FALLBACK. A code is the product's identity and
 * is what the price stage looks up, so two candidates sharing one are the same
 * product however differently they are named. Deduping on the NAME instead
 * would silently merge two real sizes of one article — the collapse Step 1077
 * measured — so the name is used only when there is no code to compare.
 *
 * ⚠️ NO THRESHOLD HERE. Which runners-up are worth SHOWING is a view-time
 * question with no measured answer yet (see `IplResultItem.alternatives`),
 * and baking one in would throw away the row the next calibration needs.
 * Zero-scored candidates are excluded, matching `pickBestMatch`.
 */
export function pickTopMatches(candidates: MoiCandidate[], max: number): IplMatch[] {
  const ranked = [...candidates]
    .filter((c) => c.percent > 0)
    // ⚠️ STABLE: equal scores keep retrieval order, so the better-retrieved
    // candidate stays first — the tie-break `pickBestMatch` already makes.
    .sort((a, b) => b.percent - a.percent);

  const seen = new Set<string>();
  const out: IplMatch[] = [];
  for (const c of ranked) {
    if (out.length >= max) break;
    const code = normaliseCode(c.code ?? "");
    const key = code || `name:${(c.name ?? "").trim().toLowerCase()}`;
    // A candidate with neither a code nor a name identifies nothing.
    if (key === "name:") continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: c.name,
      code: c.code,
      ...(c.shortName ? { shortName: c.shortName } : {}),
      ...(c.brand ? { brand: c.brand } : {}),
      percent: c.percent,
      reason: c.reason,
      sourceFile: c.sourceFile,
      ...(c.part ? { part: c.part } : {}),
    });
  }
  return out;
}

/**
 * Every matched product on a line, best first.
 *
 * ⚠️ ONE walker, because the head lives in a different field from the tail:
 * the best is `match` and the runners-up are `alternatives` (see
 * `IplResultItem` for why that split is deliberate). A second hand-written
 * copy of that join is how a surface would come to price one and render the
 * other.
 */
export function allMatchesOf(item: {
  match: IplMatch | null;
  alternatives?: IplPricedMatch[];
}): IplMatch[] {
  return [...(item.match ? [item.match] : []), ...(item.alternatives ?? []).map((a) => a.match)];
}

/* -------------------------------------------------------------------- *
 * MOI result -> IPL result.
 *
 * ⚠️ MOVED HERE FROM THE ENGINE (Step 1085), and the reason is testability
 * rather than tidiness: `lib/pricing/engine.ts` imports `adminDb`, which
 * builds credentials at MODULE LOAD, so nothing in it can be imported by a
 * free eval — the trap Steps 794, 803 and 956 each had to escape. Both
 * functions below are pure, and the mapper is where the alternatives rule
 * now lives, so it is exactly the code an eval must be able to execute.
 * -------------------------------------------------------------------- */

/**
 * Step 1032 — what of the source item the RESULT stores.
 *
 * ⚠️ IT USED TO STORE THE WHOLE THING, and `source_items` holds that same array
 * on the SAME document — so every heavy field was written twice. `refSpecsFull`
 * alone is up to 1200 chars, `specs` 500, `refSpecs` 400; at the 500 items
 * gather can produce, the duplicate is most of Firestore's 1 MiB limit.
 *
 * ⚠️ AND NOTHING ON THIS SURFACE READS THE HEAVY ONES. The table, the export
 * and `derive.ts` between them read `name`, `code` and `quantity` — and, since
 * Step 1102, the export also prints `position` and `unit`. `refSpecsFull` has
 * one reader in the entire codebase: the RETIRED MOI agent's card, off its own
 * `moi_result`, which this does not touch. The four dropped fields are
 * RETRIEVAL inputs, and retrieval has already run by the time this is written.
 *
 * ⚠️ THE SMALL SCALARS ARE LOAD-BEARING NOW. They were kept at Step 1032 "even
 * though nothing reads them" because they cost nothing; Step 1102 put
 * `position` and `unit` into the priced sheet's first and fifth columns, so
 * dropping either here would blank a column on every run from then on.
 * `eval:ipl-price` executes this mapper and pins both.
 *
 * ⚠️ NOTHING IS LOST FROM THE DOCUMENT — `source_items` still carries the full
 * item, so a stored run stays re-inspectable. Historical runs keep whatever they
 * stored; readers only ever touch the fields above.
 */
function toStoredSource(s: MoiSourceItem): MoiSourceItem {
  return {
    name: s.name,
    code: s.code,
    quantity: s.quantity,
    // Conditional spreads: Firestore rejects an `undefined` field value.
    ...(s.position ? { position: s.position } : {}),
    ...(s.unit ? { unit: s.unit } : {}),
    ...(s.kind ? { kind: s.kind } : {}),
    ...(s.ref ? { ref: s.ref } : {}),
  };
}

/**
 * MOI result -> IPL result: N scored candidates collapse to one match (or an
 * honest null), and `prices` starts empty.
 *
 * ⚠️ The collapse happens at RUN time precisely because the price stage
 * consumes `match.code`; everything after that is filtered at view time.
 */
export function toIplItems(matched: MoiResultItem[]): IplResultItem[] {
  return matched.map((m) => {
    // Step 1126 — a COMPOSITE line (every candidate tagged with the part of the
    // code it answers) takes its own path: one option PER PART, never
    // runners-up. See `toCompositeItem`.
    if (m.parts && m.parts.length > 0) {
      return toCompositeItem(m, m.parts);
    }
    // Step 1085 — the top N distinct products, best first. The head IS `match`,
    // so `alternatives` is the tail; storing the best twice would double it in
    // any surface that walks both.
    //
    // ⚠️ `pickBestMatch` is STILL the authority for `match`, not `top[0]`. The
    // two agree by construction today, and pinning `match` to the function that
    // has always produced it means a future change to the ranking cannot
    // silently move the field every existing reader goes through.
    const top = pickTopMatches(m.candidates, IPL_MAX_MATCHES);
    const best = pickBestMatch(m.candidates);
    const rest = top.filter((t) => t !== top[0]);
    return {
      source: toStoredSource(m.source),
      match: best,
      // Step 1033 — MOI has recorded this since Step 847 and this mapper dropped
      // it, so "retrieval never searched this line" and "your catalogues do not
      // have it" rendered as the same cell. Omitted when there IS a match, and
      // when MOI recorded no reason: absent has to keep meaning "we cannot say".
      ...(m.noCandidateReason ? { noMatchReason: m.noCandidateReason } : {}),
      prices: [],
      // ⚠️ OMITTED when empty, never `[]`. Absent has to keep meaning "a run
      // from before this step", so an empty array would claim we looked and
      // found no runners-up — the degrade rule `noMatchReason` already follows.
      ...(rest.length > 0 ? { alternatives: rest.map((match) => ({ match, prices: [] })) } : {}),
    };
  });
}

/**
 * Step 1126 — the IPL item for a COMPOSITE line: `A + B`, one set of several
 * products, matched once per part (see `lib/agents/moi/match.ts` `matchLine`).
 *
 * ⚠️ ONE OPTION PER PART, NEVER A RUNNER-UP. Each part's best candidate (its
 * highest score above 0) becomes an option tagged with that part; a part's
 * lower-scored candidates are dropped. Mixing runners-up into a set would put
 * "the second-best indoor unit" beside "the outdoor unit" as if the reader
 * were choosing between them, when one is required and the other is a
 * substitute — the whole distinction this step exists for. A single-product
 * line keeps Step 1085's runners-up exactly as before.
 *
 * ⚠️ THE HEAD IS STILL THE GLOBAL BEST. `pickBestMatch` over every candidate
 * stays the authority for `match` — the field every reader, the identity
 * credit and `hasMatch` go through — so on the operator's line the exact-code
 * outdoor unit leads and the indoor unit follows as an alternative. Both are
 * tagged, so every surface can tell a part from a runner-up whichever slot it
 * sits in.
 *
 * ⚠️ A PART THAT MATCHED NOTHING IS RECORDED, not dropped. `partsNotFound`
 * carries the code's own words for it, in the code's order, so the card and
 * the sheet can say "RWM10.0N1E — not found" beside the half that priced.
 * Measured on the operator's corpus that IS the live case: the tender names
 * `RWM10.0N1E`, the Hitachi list carries only the `RWM-10.0N3E` variant, and a
 * silent half-quote is the failure this step was asked to stop.
 */
function toCompositeItem(m: MoiResultItem, parts: readonly string[]): IplResultItem {
  // ⚠️ `parts` comes from the matcher, NOT from the candidates' tags: a part
  // whose retrieval returned nothing has no candidate to be tagged on, and it
  // is exactly the part `partsNotFound` exists to name.
  const bestOf = new Map<string, IplMatch | null>();
  for (const part of parts) {
    bestOf.set(part, pickBestMatch(m.candidates.filter((c) => c.part === part)));
  }
  const head = pickBestMatch(m.candidates);
  const alternatives: IplPricedMatch[] = [];
  const partsNotFound: string[] = [];
  for (const part of parts) {
    const best = bestOf.get(part) ?? null;
    if (!best) {
      partsNotFound.push(part);
      continue;
    }
    if (head && best.part === head.part) continue; // the head's own part
    alternatives.push({ match: best, prices: [] });
  }
  return {
    source: toStoredSource(m.source),
    match: head,
    ...(m.noCandidateReason ? { noMatchReason: m.noCandidateReason } : {}),
    prices: [],
    ...(alternatives.length > 0 ? { alternatives } : {}),
    ...(partsNotFound.length > 0 ? { partsNotFound } : {}),
  };
}

/**
 * Does this line have a match at all?
 *
 * ⚠️ Step 1118 — the three-valued `matchTier` (confident / low / none) is GONE
 * with the confidence floor. A match is a match now, so the only question left
 * is match-or-not: `hasMatch` for the header's "Identified", `noMatchKind`
 * (below) for WHY a line has none. A price counts whatever the judge's score.
 */
export function hasMatch(item: IplResultItem): boolean {
  return item.match != null;
}

/**
 * Step 1033 — WHICH of the ways a line ended up with no match, for a surface.
 *
 * Four causes collapse to three things worth saying, because two of them are
 * the same instruction to the reader:
 *
 *   not_searched   retrieval returned nothing even after its retry. A FAILURE,
 *                  ours, and re-running usually fixes it. The only one that is
 *                  actionable, so the only one rendered in amber.
 *   not_a_product  a bulk material or a labour line (Step 830). Never searched,
 *                  correctly — nothing to fix and nothing to buy.
 *   not_found      searched, and nothing in the documents matched.
 *
 * ⚠️ `not_found` is also the fallback for a run stored BEFORE the reason
 * existed, and that is why its wording has to be the one that is true either
 * way. A default of "we searched and found nothing" would be a claim about a
 * run we have no record of — the honest default is the wording the card
 * already used.
 */
export type IplNoMatchKind = "not_searched" | "not_a_product" | "not_found";

export function noMatchKind(item: IplResultItem): IplNoMatchKind {
  if (item.noMatchReason === "retrieval_empty") return "not_searched";
  if (item.noMatchReason === "not_a_product") return "not_a_product";
  return "not_found";
}

/** How many lines retrieval never managed to search — the one worth a badge. */
export function countNotSearched(result: IplResult): number {
  return result.items.filter((i) => !i.match && noMatchKind(i) === "not_searched").length;
}

/* ===================================================================== *
 * THE COLUMN MODEL — off every production path since Step 1086.
 *
 * ⚠️ `priceColumns`, `pricesFor`, `priceFor`, `lineTotal`, `summariseColumn`
 * and `summariseColumns` are no longer called by the card, the page or the
 * export. The result renders one row per matched OPTION and sums the user's
 * SELECTION (`pricedOptionsOf` + `summariseSelection`), because a line matching
 * two products in the SAME price list had nowhere to put the second — a column
 * per list gives each line exactly one cell per list, so `priceFor` silently
 * took the first and a note said "first used".
 *
 * ⚠️ KEPT ON PURPOSE, AND THIS COMMENT IS THE POINT. They stay exercised by
 * `eval:ipl-price`'s TOTALS section (15 cases), which is the written record of
 * the Step-726/734/815 guards `summariseSelection` inherited — deleting them in
 * the same step that introduced the replacement would remove the before-picture
 * the new guards are checked against. What must NOT happen is someone fixing a
 * bug in here and wondering why the screen does not change: nothing on screen
 * reads any of it. Removing them is deliberate follow-up work, not a tidy-up.
 * ===================================================================== */

/**
 * The distinct documents that yielded a price, in first-seen order across the
 * whole result — i.e. the price COLUMNS.
 *
 * First-seen rather than alphabetical so the leftmost column is the list that
 * priced the earliest items, which in practice is the user's primary list. No
 * classification step: a document is a "price list" here precisely because it
 * produced a price, which is both simpler than a classifier and unable to be
 * wrong in the way a classifier is.
 */
export function priceColumns(result: IplResult): string[] {
  const seen = new Set<string>();
  const cols: string[] = [];
  for (const item of result.items) {
    for (const p of item.prices) {
      if (p.sourceFile && !seen.has(p.sourceFile)) {
        seen.add(p.sourceFile);
        cols.push(p.sourceFile);
      }
    }
  }
  return cols;
}

/**
 * The price for one item in one column, or null.
 *
 * Returns the FIRST price under `pricesFor`'s deterministic order. A file can
 * legitimately list the same code more than once — quantity tiers ("1-9 @ 10.00",
 * "10+ @ 8.50") are the common case — so this IS a choice, and the card + the
 * export both disclose it as `multiplePriceLines`. What Step 734 changed is that
 * the choice is now reproducible: it used to be Firestore's iteration order.
 */
export function priceFor(item: IplResultItem, sourceFile: string): IplPrice | null {
  return pricesFor(item, sourceFile)[0] ?? null;
}

/**
 * Every price this item has in one column — length > 1 means a tier/duplicate.
 *
 * Step 734 (audit C7) — ORDERED, because "the first price" was previously
 * Firestore's iteration order across the file's rows. Two identical runs could
 * put a different price first, so a line total and a column total could flip
 * between them with nothing in the output to explain it. The order is derived
 * ENTIRELY from the price's own content, so it is stable across runs and across
 * already-stored results:
 *
 *   1. carries a currency        — the strongest evidence the value is money
 *   2. its header names money    — "Price EUR" over an unlabelled column
 *   3. NET before GROSS          — a price list's headline figure is the net one
 *   4. highest value             — only reachable for same-label duplicates, i.e.
 *                                  quantity tiers. Understating a cost reads as a
 *                                  better deal, so the conservative end is the
 *                                  safer default; `multiplePriceLines` reports
 *                                  that a choice was made either way.
 *   5. label A→Z                 — a total tiebreak, so nothing is left to chance
 */
export function pricesFor(item: IplResultItem, sourceFile: string): IplPrice[] {
  return item.prices.filter((p) => p.sourceFile === sourceFile).sort(comparePrices);
}

/** net → 0, unlabelled → 1, gross → 2. */
function netGrossRank(label: string): number {
  const l = label.toLowerCase();
  if (/(?<![\p{L}\p{N}])(net|netto|be pvm|бе[зс] ндс)(?![\p{L}\p{N}])/u.test(l)) return 0;
  if (/(?<![\p{L}\p{N}])(gross|brutto|su pvm|vat incl|incl\. vat)(?![\p{L}\p{N}])/u.test(l))
    return 2;
  return 1;
}

function comparePrices(a: IplPrice, b: IplPrice): number {
  const cur = (a.currency ? 0 : 1) - (b.currency ? 0 : 1);
  if (cur !== 0) return cur;
  const named = (isPriceHeader(a.label) ? 0 : 1) - (isPriceHeader(b.label) ? 0 : 1);
  if (named !== 0) return named;
  const ng = netGrossRank(a.label) - netGrossRank(b.label);
  if (ng !== 0) return ng;
  if (a.value !== b.value) return b.value - a.value;
  return a.label.localeCompare(b.label);
}

/* -------------------------------------------------------------------- *
 * THE PRICED LIST (Step 1085) — what the card shows, one row per OPTION.
 * -------------------------------------------------------------------- */

/**
 * One option on the card: a matched product, its chosen price, and where in the
 * item it sits so a selection can name it.
 */
export interface IplOption {
  match: IplMatch;
  /** The price this option is quoted at, or null when nothing priced it. */
  price: IplPrice | null;
  /** Every price found for this match — length > 1 means a tier or a duplicate. */
  prices: IplPrice[];
  /** 0 = the best match; 1..n = the runners-up, in `alternatives` order. */
  index: number;
}

/**
 * The price one MATCH is quoted at, under the same order `priceFor` uses.
 *
 * ⚠️ SAME COMPARATOR, deliberately. `priceFor` picks the first price of one
 * FILE; this picks the first across every file that priced this match, because
 * the new layout has no columns to pick a file with. Reusing `comparePrices`
 * is what keeps the two answers consistent — currency first, then a header that
 * names money, then net before gross, then the higher value (understating a
 * cost reads as a better deal). A second ordering here would let the card and
 * the export disagree about which number a row is quoting.
 */
export function priceOfMatch(prices: IplPrice[]): IplPrice | null {
  return [...prices].sort(comparePrices)[0] ?? null;
}

/**
 * Every option on one line, best first — the head is `match`/`prices`, the tail
 * is `alternatives`.
 *
 * ⚠️ UNPRICED OPTIONS ARE DROPPED, and only here. An alternative nobody can
 * quote is not a choice, so listing it would ask the user to pick something
 * that cannot enter the total. The LINE still survives this — whether it has
 * any option at all is `hasPricedOption`, and a line with none is collapsed
 * rather than deleted (the Step-1033 rule: "not searched", "not found" and
 * "not a product" are three different answers, and a buyer must not be told the
 * second when we mean the first).
 */
export function pricedOptionsOf(item: IplResultItem, max: number): IplOption[] {
  const priced = allPricedOptionsOf(item);
  // ⚠️ The best among the PRICED options, computed BEFORE the cap — so `max`
  // cannot change which options qualify, only how many of them are returned.
  const best = Math.max(0, ...priced.map((o) => o.match.percent));
  // Step 1126 — a PART of a composite line is a required piece of the item,
  // not a runner-up: it is shown whatever it scored and however far below the
  // best it sits, and it takes no slot from the cap. The bar and the cap
  // apply to runners-up only, exactly as before.
  const shownRunnersUp = priced
    .filter((o) => !o.match.part && optionIsWorthShowing(o.match.percent, best))
    .slice(0, max);
  return priced.filter((o) => o.match.part !== undefined || shownRunnersUp.includes(o));
}

/**
 * Every option that carries a price, BEFORE the Step-1088 display rules.
 *
 * ⚠️ EXISTS SO A SURFACE CAN SAY WHY NOTHING IS SHOWN. A line whose every
 * option was hidden is not the same as a line the user unticked, and not the
 * same as a line nothing matched — the export has to tell those apart or it
 * reports our own display rule as the user's choice.
 *
 * ⚠️ Uncapped on purpose: the cap belongs to the caller, after filtering, or a
 * hidden option would consume a slot a good one could have used. (`IPL_MAX_MATCHES`
 * already bounds `alternatives` at RUN time, so this is a property of the code
 * rather than a case that fires today.)
 */
export function allPricedOptionsOf(item: IplResultItem): IplOption[] {
  const all: Array<{ match: IplMatch; prices: IplPrice[] }> = [
    ...(item.match ? [{ match: item.match, prices: item.prices }] : []),
    ...(item.alternatives ?? []),
  ];
  const out: IplOption[] = [];
  for (const [index, pm] of all.entries()) {
    const price = priceOfMatch(pm.prices);
    if (!price) continue;
    // ⚠️ `index` is the position in `all`, NOT in `out`. The selection keys on
    // it (Step 1086), so re-indexing after a filter would tick one option and
    // price another — the Step-1081 defect one layer down.
    out.push({ match: pm.match, price, prices: pm.prices, index });
  }
  return out;
}

/**
 * The operator's two display rules (Step 1088), as ONE predicate.
 *
 * A candidate is worth offering when it is not noise on its own AND not far
 * worse than the best thing on the same line. Both numbers are theirs; see
 * `IPL_MIN_OPTION_PERCENT` / `IPL_MAX_OPTION_GAP` for what they are and are not.
 *
 * ⚠️ ONE predicate rather than two inline comparisons, because this is exactly
 * the shape Step 815 records going wrong: two copies of one test that disagreed,
 * so a line contributed money the card said was excluded. The card, the default
 * selection, the total and the export all read it through `pricedOptionsOf`.
 */
export function optionIsWorthShowing(percent: number, best: number): boolean {
  return percent >= IPL_MIN_OPTION_PERCENT && best - percent <= IPL_MAX_OPTION_GAP;
}

/** Does this line have anything the user could put in a quote? */
export function hasPricedOption(item: IplResultItem): boolean {
  return pricedOptionsOf(item, 1).length > 0;
}

export interface IplSummary {
  /** Rows with a match. ⚠️ Step 1118 — no confidence tier any more: a match is
   *  a match, so this is every line that got a product. */
  matched: number;
  /** Rows with no match at all. */
  none: number;
  total: number;
}

/** Counts for the card's header stats. */
export function summarise(result: IplResult): IplSummary {
  let matched = 0;
  let none = 0;
  for (const item of result.items) {
    if (hasMatch(item)) matched += 1;
    else none += 1;
  }
  return { matched, none, total: result.items.length };
}

/* ==========================================================
 * Totals (Step 726, PR 3)
 *
 * A grand total is the most authoritative-looking number this agent produces
 * and therefore the easiest one to be quietly wrong with. Three ways it lies if
 * you just add prices up, and every field below exists to stop one of them:
 *
 *   COVERAGE   list A prices 8 of 10 lines, list B prices 10 of 10. Their totals
 *              are not comparable, but side by side they look it — and the
 *              cheaper-looking column is usually just the one that priced less.
 *   CURRENCY   EUR + USD summed is a meaningless number that still renders.
 *   AMBIGUITY  a row carrying Net AND Gross has no single price; picking one
 *              without saying so turns a choice into a fact.
 * ========================================================== */

/** A total is always per CURRENCY — mixing them is never summed, only listed. */
export interface IplColumnTotal {
  /** "" when the source states no currency. */
  currency: string;
  sum: number;
  /** Lines that contributed to this figure. */
  lines: number;
}

export interface IplColumnSummary {
  sourceFile: string;
  /** One entry per currency present. Length > 1 means DON'T read these as one. */
  totals: IplColumnTotal[];
  /** Lines this column priced, out of the whole list. */
  priced: number;
  /** The coverage DENOMINATOR — the lines this run set out to process, not the
   *  lines it managed to (Step 815 / R2). */
  total: number;
  /** Step 815 (R2) — lines this run never reached, because the user cancelled
   *  or it stopped early. > 0 means `priced/total` is coverage of an INCOMPLETE
   *  pass and must be labelled as such wherever the total is shown. */
  notProcessed: number;
  /** Distinct column headers that fed the sum. More than one = net/gross-style
   *  ambiguity: the number is real but says different things per line. */
  labels: string[];
  /** Lines where the source list carried no quantity and 1 was assumed. */
  assumedQty: number;
  /** Lines where this column offered SEVERAL prices and the first was used. */
  multiplePriceLines: number;
}

/**
 * Quantity for a line total.
 *
 * Missing quantity defaults to 1 rather than excluding the line, because a
 * materials list without quantities is a real and common input — and there the
 * "total" the user wants IS the sum of unit prices. The cost of the default is
 * that a MIXED list (some lines quantified, some not) would silently under-count,
 * so `assumedQty` counts the assumptions and the card shows them. A convenient
 * default is fine; an invisible one is not.
 */
export function quantityFor(item: IplResultItem): number {
  return quantityWasAssumed(item) ? 1 : (item.source.quantity as number);
}

/**
 * Did this line's quantity get substituted?
 *
 * Step 815 (audit N1) — ONE predicate, because there used to be two and they
 * disagreed. `quantityFor` substituted 1 for null OR <= 0 OR non-finite, while
 * `summariseColumn` counted assumptions with `quantity == null` alone: a line
 * carrying `quantity: 0` (or a negative, or NaN) silently contributed 1 x price
 * to the total while the card and the export reported nothing assumed.
 * Measured: 3 substitutions, `assumedQty: 1`.
 *
 * That is exactly the failure `assumedQty` exists to prevent — "a convenient
 * default is fine; an invisible one is not" — so the count now derives from the
 * same test that does the substituting, and cannot drift from it again.
 */
/**
 * A money figure, as the screen shows it — Step 1101.
 *
 * ## ⚠️ ALWAYS TWO DECIMALS, whatever the price list carried
 *
 * The operator's report, from a real run: `6 283,471 EUR` on a row. The value is
 * RIGHT — Step 922's four-decimal rules exist because price lists genuinely
 * store `37.7934`, and a parser that rounded them would be wrong on 81% of the
 * priced corpus. But a figure a buyer reads against a quote is money, and money
 * has two decimals. The row showed the stored precision; the total capped at
 * two. Two spellings of one number, 30px apart.
 *
 * ⚠️ DISPLAY ONLY. The stored value, the per-line total and the currency sums
 * are all computed from full precision (`summariseSelection`) and rounded ONCE,
 * here, at the last moment. Rounding each row and then summing the rounded rows
 * is a different (wrong) total — so the displayed rows may not visibly add to
 * the displayed total by a cent, and that is the total being right.
 *
 * ⚠️ `minimumFractionDigits` AS WELL AS MAXIMUM. The total already capped at two
 * but had no floor, so `880` rendered as `880` beside rows reading `879,69` —
 * a whole number of euros reads as an estimate, not a price.
 *
 * ⚠️ THE LOCALE IS REQUIRED, AND IT IS THE RESULT'S (Step 1149). Until 1149 the
 * page passed `undefined` — "the viewer's locale, deliberately", so the operator
 * saw `6 283,47` — and Step 1114 gave only the template export a locale
 * (`documentLocale(result.lang)`) after the SERVER printed `6,283.47` on a
 * Lithuanian quote. But the page is server-rendered too (Step 931), and
 * `undefined` there is the SAME Node ICU default: en-US on Vercel. So every
 * priced run rendered `6,283.47` into the HTML and `6 283,47` on the reader's
 * first client render — a React hydration mismatch (#418, text) on every load
 * of a priced run by anyone outside en-US. React recovers by regenerating the
 * whole tree from the root (there is no Suspense boundary above a page), which
 * clears `<body>`'s children — including the `<div>` Firebase App Check had
 * appended for its invisible reCAPTCHA, whose render then threw "placeholder
 * element must be an element or id" and left the page load with no App Check
 * token at all. Measured in `drive-step-1149.ts` (a browser whose locale is not
 * the server's). The screen now formats in `documentLocale(result.lang)`, the
 * export's locale: the sheet, the document and the page spell one number one
 * way, and the server and the browser agree because neither asks its own OS.
 * ⚠️ `undefined` IS NOT ALLOWED any more — the parameter is required so the
 * next caller cannot reintroduce the machine's locale by leaving it out. The
 * sheet is NOT formatted here: a spreadsheet cell keeps the full stored number
 * so the sheet stays summable (Step 1064), and Excel formats it itself.
 */
export function formatMoney(value: number, locale: string): string {
  return value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function quantityWasAssumed(item: IplResultItem): boolean {
  return !hasStatedQuantity(item.source);
}

/**
 * Does this line STATE a quantity we can use?
 *
 * Step 1067 — split out of `quantityWasAssumed` so the CONFIRM step can ask the
 * same question of a raw source line, before there is any `IplResultItem` to
 * wrap it. Step 815's whole point was that two copies of this test disagreed;
 * a third copy in `confirm.ts` would be the same mistake with a longer gap
 * between the two answers.
 */
export function hasStatedQuantity(source: Pick<MoiSourceItem, "quantity">): boolean {
  const q = source.quantity;
  return typeof q === "number" && Number.isFinite(q) && q > 0;
}

/**
 * Step 1122 — a line's unit as it is SHOWN or EXPORTED: trimmed, with a
 * trailing prime dropped. `m'` → `m`, `m′` → `m`, `m’` → `m`.
 *
 * Operator's ask, on the stage-1 sheet of a real tender: *"remove ' from m"*.
 * Lithuanian bills of quantities write running metres as `m'`, and Step 862
 * stores the unit VERBATIM — rightly, since nothing re-extracts (the Step-917
 * rule) and the document said what it said. So the mark comes off at the
 * OUTPUT, in the one place every surface that prints a unit goes through: the
 * confirm card (`formatQuantity`), both stage-1 tabs, the priced sheet and the
 * letterhead export. Four surfaces, one rule — the card and the file must not
 * describe one line in two vocabularies (the Step-1033 rule).
 *
 * ⚠️ ONLY AFTER A LETTER. A prime that follows a digit or stands alone is a
 * unit in its own right — `12'` and `'` are FEET in an imperial document, `"`
 * is inches — and this is a universal product. `(\p{L})` is what keeps the
 * rule to `m'` / `vnt'` and off `'`. Built as a regex LITERAL: inside a
 * template literal `\p` collapses to `p` and the class silently becomes a
 * substring match (the Step-734 trap).
 */
export function displayUnit(unit: string | null | undefined): string {
  const u = typeof unit === "string" ? unit.trim() : "";
  return u.replace(/(\p{L})['’′´`]+$/u, "$1");
}

/** The price used for one line in one column: the FIRST, i.e. the leftmost money
 *  column of that row. `multiplePriceLines` reports when that was a choice. */
export function totalPriceFor(item: IplResultItem, sourceFile: string): IplPrice | null {
  return priceFor(item, sourceFile);
}

/**
 * Everything the card needs to show one price column honestly.
 *
 * ⚠️ Step 1118 — NO CONFIDENCE FLOOR. Every line with a price in this column is
 * summed; the "below floor" exclusion (Step 734) and its `excludedLowConfidence`
 * count are gone, by operator decision ("if there is a price, calculate it").
 * The other three honesty guards — coverage, currency, ambiguity — are
 * untouched: those are about whether prices are COMPARABLE, not about how much
 * to trust a match.
 */
export function summariseColumn(result: IplResult, sourceFile: string): IplColumnSummary {
  const byCurrency = new Map<string, IplColumnTotal>();
  const labels = new Set<string>();
  let priced = 0;
  let assumedQty = 0;
  let multiplePriceLines = 0;

  for (const item of result.items) {
    const all = pricesFor(item, sourceFile);
    if (all.length === 0) continue;
    priced += 1;
    if (all.length > 1) multiplePriceLines += 1;

    const p = all[0];
    if (!p) continue;
    labels.add(p.label);
    // Step 815 (N1) — the SAME predicate that performs the substitution.
    if (quantityWasAssumed(item)) assumedQty += 1;

    const entry = byCurrency.get(p.currency) ?? { currency: p.currency, sum: 0, lines: 0 };
    entry.sum += p.value * quantityFor(item);
    entry.lines += 1;
    byCurrency.set(p.currency, entry);
  }

  // Step 815 (R2) — the denominator is what the run SET OUT to price. It used to
  // be `result.items.length`, i.e. what it managed to price, so a run cancelled
  // after 8 of 50 lines reported "8/8 priced": the coverage guard — built
  // precisely so two columns are never compared at unequal coverage — reported
  // full coverage on a 16% pass.
  const requested = Math.max(result.requested_count ?? result.items.length, result.items.length);

  return {
    sourceFile,
    // Largest first, so the dominant currency reads as the headline figure when
    // a stray row in another currency drags one line into its own total.
    totals: [...byCurrency.values()].sort((a, b) => b.lines - a.lines),
    priced,
    total: requested,
    notProcessed: requested - result.items.length,
    labels: [...labels],
    assumedQty,
    multiplePriceLines,
  };
}

/**
 * What the user has ticked, as a total that says what it summed.
 *
 * ⚠️ A LINE MAY CONTRIBUTE MORE THAN ONE PRICE, and that is the whole
 * reason this exists rather than reusing `summariseColumn`. The operator's
 * decision (Step 1086) is that options are ADDITIVE: two rows under one line
 * may be two suppliers to compare, or two parts of one package, and the
 * document is a working list whose reader knows which. The arithmetic is the
 * same either way — sum what is ticked.
 *
 * ⚠️ SO THE TOTAL MUST DISCLOSE IT. `263.22` for a line asking for ONE tank
 * is correct arithmetic and reads as one tank, so `multiOptionLines` counts the
 * lines that contributed more than once. Same rule as `assumedQty`: a
 * convenient default is fine, an invisible one is not.
 *
 * ⚠️ UNTICKING IS THE WAY TO A SINGLE-PRICE QUOTE. A user who narrows every
 * line to one option gets `multiOptionLines === 0` and an unambiguous figure —
 * which is why the count is on the TOTAL rather than a warning on the list.
 */
export interface IplSelectionSummary {
  /** One entry per currency present. Length > 1 means DON'T read these as one. */
  totals: IplColumnTotal[];
  /** Lines contributing at least one ticked price. */
  priced: number;
  /** The coverage denominator — what the run SET OUT to price (Step 815). */
  total: number;
  /** Lines the run never reached, so `priced/total` is an INCOMPLETE pass. */
  notProcessed: number;
  /** Distinct column headers that fed the sum — more than one means net/gross
   *  style ambiguity: the number is real but says different things per line. */
  labels: string[];
  /** Lines where the source list carried no quantity and 1 was assumed. */
  assumedQty: number;
  /** Lines that contributed MORE THAN ONE price to the figure above. */
  multiOptionLines: number;
}

/**
 * `selected` maps an item index to the option indices ticked on that line.
 * A missing entry means "nothing ticked", NOT "everything" — the caller owns
 * the default, and defaulting here would make an untick indistinguishable from
 * an unvisited line.
 *
 * ⚠️ Step 1118 — every ticked, priced option is summed; there is no confidence
 * floor holding any of them out (a match is a match).
 */
export function summariseSelection(
  result: IplResult,
  selected: ReadonlyMap<number, ReadonlySet<number>>,
  maxOptions: number,
): IplSelectionSummary {
  const byCurrency = new Map<string, IplColumnTotal>();
  const labels = new Set<string>();
  let priced = 0;
  let assumedQty = 0;
  let multiOptionLines = 0;

  for (const [i, item] of result.items.entries()) {
    const ticked = selected.get(i);
    if (!ticked || ticked.size === 0) continue;
    const options = pricedOptionsOf(item, maxOptions).filter((o) => ticked.has(o.index));
    if (options.length === 0) continue;

    let contributed = 0;
    let runnersUp = 0;
    for (const o of options) {
      const p = o.price;
      if (!p) continue;
      labels.add(p.label);
      const entry = byCurrency.get(p.currency) ?? { currency: p.currency, sum: 0, lines: 0 };
      // The LINE's quantity, per option — right for two suppliers of one item
      // and right for two parts of one package.
      entry.sum += p.value * quantityFor(item);
      entry.lines += 1;
      byCurrency.set(p.currency, entry);
      contributed += 1;
      if (!o.match.part) runnersUp += 1;
    }

    if (contributed === 0) continue;
    priced += 1;
    // Step 1126 — a set's parts are NOT a line "counted more than once": six
    // indoor units plus six outdoor units IS the price of six sets. Only
    // runners-up (two suppliers of one product, both ticked) earn the note.
    if (runnersUp > 1) multiOptionLines += 1;
    // Step 815 (N1) — the SAME predicate that performs the substitution, and
    // counted once per LINE however many options it contributed.
    if (quantityWasAssumed(item)) assumedQty += 1;
  }

  const requested = Math.max(result.requested_count ?? result.items.length, result.items.length);

  return {
    totals: [...byCurrency.values()].sort((a, b) => b.lines - a.lines),
    priced,
    total: requested,
    notProcessed: requested - result.items.length,
    labels: [...labels],
    assumedQty,
    multiOptionLines,
  };
}

/**
 * Every line's options ticked — the default the operator specified.
 *
 * ⚠️ LINES WITH NO PRICED OPTION GET NO ENTRY AT ALL, so they cannot enter a
 * total and cannot be "unticked" into one. They are collapsed rather than
 * deleted (the Step-1033 rule: "not searched", "not found" and "not a product"
 * are three different answers, and a buyer must not be told the second when we
 * mean the first).
 */
export function defaultSelection(result: IplResult, maxOptions: number): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  for (const [i, item] of result.items.entries()) {
    const options = pricedOptionsOf(item, maxOptions);
    if (options.length === 0) continue;
    out.set(i, new Set(options.map((o) => o.index)));
  }
  return out;
}

/** Column summaries in the same order as `priceColumns`. */
export function summariseColumns(result: IplResult): IplColumnSummary[] {
  return priceColumns(result).map((c) => summariseColumn(result, c));
}

/** The line total shown per row: quantity x the price used for that column. */
export function lineTotal(item: IplResultItem, sourceFile: string): number | null {
  const p = totalPriceFor(item, sourceFile);
  return p ? p.value * quantityFor(item) : null;
}
