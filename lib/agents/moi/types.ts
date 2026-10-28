/**
 * MOI (Matching of Items) — shared types + constants (Phase 1).
 *
 * MOI is a STANDALONE, file-input agent (unlike RFQ/BOM which transform an
 * existing answer). The user uploads one item list; Stage 1 extracts the
 * source items, Stage 2 matches each against the user's catalogues and scores
 * the match. See the build spec / "How AI agents work" for the full design.
 *
 * Pure types + constants — no imports, no env reads — so both client and
 * server can import freely.
 */

/** A device/material line pulled from the uploaded source file (Stage 1). */
/** Step 830 — see MoiSourceItem.kind. */
export type MoiLineKind = "product" | "material" | "service";

export interface MoiSourceItem {
  /**
   * Step 818 — the ROW'S OWN identifier in a tender / bill-of-quantities table
   * ("a-2", "5", "Poz. 12"); "" when the document has no such column.
   *
   * The only field in this shape that is unique BY CONSTRUCTION, which is what
   * makes it the safe consolidation key. The operator's tender showed why one
   * was needed: its rows cite a SHARED specification reference ("TS-2.2" on
   * many rows), the extractor was putting that in `code`, and merging on it
   * collapsed four different valve sizes into one line.
   */
  position?: string;
  /**
   * Step 820 — the SPECIFICATION REFERENCE this row cites ("TS-1.01.2"), or ""
   * / absent. Many rows share one; that is the point. It is the join key onto
   * the document's specifications section.
   *
   * ⚠️ NOT a code and never treated as one — Step 817 showed that merging rows
   * on a shared reference collapses four valve sizes into one line. Same field
   * family, opposite use: a reference ENRICHES rows, it never merges them.
   */
  ref?: string;
  /**
   * Step 820 — identifying attributes inherited from that reference's spec
   * block, already distilled. Kept SEPARATE from `specs` (the row's own detail)
   * so the card can keep showing a simple name while search and the judge get
   * the full picture.
   */
  refSpecs?: string;
  /**
   * Step 826 — the reference's VERBATIM folded text, present ONLY when
   * `refSpecs` was distilled into a search summary. The card shows this so a
   * human still verifies the join against the document's own words; the
   * summary feeds the query and the judge. Absent means `refSpecs` IS verbatim.
   */
  refSpecsFull?: string;

  /**
   * Step 830 — what KIND of line this is. Only a `product` is worth matching.
   *
   * A bill of quantities is not a shopping list. Measured on the operator's
   * 112-line tender, the >=60 band held three different kinds of row and only
   * one of them names something a supplier sells:
   *   product  — "Rutulinis ventilis", "Y-formos nešmenų gaudytuvas" → 85%, stable
   *   material — "Metalas", "Cinkuota skarda" → 5% or 85% depending on the run,
   *              because a one-word bulk material has nothing to match ON
   *   service  — "Šilumos punkto paleidimo derinimo darbai" (commissioning
   *              labour) → 80% against a page of text about commissioning
   *
   * Absent or unrecognised means `product`: never silently skip a real item.
   */
  kind?: MoiLineKind;
  /** Item description / name, verbatim in its original language (never translated). */
  name: string;
  /** Article / model / catalogue code, or "" when none. */
  code: string;
  /** Listed quantity as a number, or null when the file has none. */
  quantity: number | null;
  /**
   * Step 862 — the UNIT that quantity is counted in, VERBATIM from the document
   * ("vnt.", "m", "kg", "kompl.", "m2"). A quantity without its unit is not
   * orderable: 120 metres of insulation and 120 pieces are different purchases,
   * and the document always says which. "" when the row has no unit column.
   */
  unit?: string;
  /**
   * Step 884 — SEARCH TERMS for this item, written by the extractor.
   *
   * The catalogue side of the join has been keyword-indexed since Step 344 —
   * every vector carries a bilingual `keywords[]` and `keywordSearch` queries it.
   * The ITEM side had nothing: its name/code/specs were blob-joined into a query
   * and handed to the chat REWRITER to guess search terms from.
   *
   * The extractor is the better author. It sees the group heading, the section,
   * the spec reference and the neighbouring rows; the rewriter sees a 500-char
   * blob. It also costs nothing extra (it rides a call already happening), is
   * written ONCE and stored (so it cannot vary run to run), and has none of the
   * rewriter's measured number-dropping.
   *
   * ⚠️ STORED ONLY — IT DOES NOT DRIVE RETRIEVAL, BECAUSE IT MEASURED WORSE.
   * Three arms on the operator's 36 labels, each judging its own retrieval:
   *
   *     A  today, rewriter only          ok 13   wrong 1
   *     B  + these keywords leading      ok 12   wrong 1   <- no gain
   *     C  these keywords, NO rewriter   ok  9   wrong 0   <- -4 correct
   *
   * C is the verdict that matters: it reproduces Step 733 rather than
   * overturning it. The keywords themselves are good ("Šilumos siurblys |
   * Yutakis | RWM10.0N1E | Oras vanduo | 24kW") — but they feed the KEYWORD leg,
   * and the DENSE legs do the cross-lingual work. Sharpening one leg cannot
   * replace the leg that needs an embedding, which needs the rewriter's query.
   *
   * ⚠️ Step 902 — NO LONGER PRODUCED. Step 884 kept it on the grounds that "it
   * costs nothing (it rides a call already happening)". That was wrong in the one
   * way that mattered: it rides the call's INPUT for free but it is OUTPUT, and
   * output is the dominant extraction cost. 3-8 terms on every one of 158 rows,
   * for a field no production code path has ever read — the prompt asked for it,
   * the parser stored it, and `match.ts` deliberately does not pass it.
   *
   * The field stays on the TYPE because run documents written before this step
   * still carry it, and reading one back must keep type-checking. Nothing writes
   * it now. If the product-table design ever needs a keyword join, re-add it
   * there and measure the output cost as part of that decision rather than
   * inheriting it.
   */
  keywords?: string[];
  /** Step 457 — key distinguishing specs / features (capacity, voltage, screen
   *  or control type, material, connection…), verbatim + brief; "" / absent when
   *  none. Kept SEPARATE from `name` (which stays the clean product name) and fed
   *  to the judge so it can pick the RIGHT variant — e.g. an LCD model over an
   *  otherwise-identical LED one. */
  specs?: string;
}

/** A scored candidate match from the user's catalogues (Stage 2). */
export interface MoiCandidate {
  name: string;
  code: string;
  /**
   * Step 840 — the four things a buyer needs to act, per the operator: a SHORT
   * name, the model/code, the BRAND, and the score. `name` stays the product's
   * FULL model name (the export and every stored run depend on it); these two
   * are additive and absent on runs from before this step.
   */
  shortName?: string;
  brand?: string;
  /** 0–100 match score from the LLM judge. */
  percent: number;
  /** One-line rationale, in the runner's preferred_language (preview-only). */
  reason: string;
  /** Which of the user's documents the candidate came from (traceability). */
  sourceFile: string;
  /**
   * Step 1126 — on a COMPOSITE line (`A + B`, one set of several products),
   * the part of the source code this candidate answers, verbatim. Every
   * candidate of such a line carries one; a single-product line's candidates
   * carry none. See `lib/agents/moi/composite.ts`.
   */
  part?: string;
}

/** One source item + ALL its scored candidates (top-K), sorted desc. Thresholds
 *  are applied at VIEW/DOWNLOAD time, not stored filtered — so the same run is
 *  instantly re-tunable + re-localizable without re-matching. */
export interface MoiResultItem {
  source: MoiSourceItem;
  candidates: MoiCandidate[];
  /**
   * Step 1126 — set ONLY on a composite line: every part of its code, in the
   * code's order, whether or not the part found a candidate. The tags on
   * `candidates` cannot carry this — a part whose retrieval came back empty has
   * no candidate to tag — and the IPL mapper needs the full list to say which
   * parts were NOT found. Absent on a single-product line.
   */
  parts?: string[];
  /**
   * Step 831 — the exact chunks the judge read, kept for a SAMPLE of items.
   *
   * Every diagnosis of a bad match this month has been blocked at the same
   * point: production scored something oddly and the shortlist behind it was
   * gone, so the only way to look was to re-run retrieval and hope it returned
   * the same six chunks. Four separate hypotheses died on evidence that could
   * not be reproduced, and each cost more than storing a few kilobytes would.
   *
   * Sampled, not universal: the whole result already lives in ONE Firestore
   * document under a 1 MiB ceiling, and 112 items x 6 chunks would blow it.
   */
  shortlist?: MoiShortlistChunk[];
  /**
   * Step 847 — WHY this item has no candidates, when it has none.
   *
   * "Nothing was found" and "we never managed to look" render identically —
   * the row simply is not in the list — and the system knows the difference.
   * Measured on the operator's 112-line tender: 10 items came back with an
   * EMPTY shortlist, and among them `Atbulinis vožtuvas a-5` while a-1…a-4,
   * the same valve in other sizes from the same catalogue, matched at 85%.
   * That is retrieval failing on a query demonstrably known to work, not a
   * product the corpus lacks.
   *
   * Absent when the item HAS candidates. `not_a_product` is the Step-830 skip.
   */
  noCandidateReason?: MoiNoCandidateReason;
}

/**
 * Step 847 — the three ways an item ends up with nothing, which are three
 * different things to tell a user.
 *
 * `retrieval_empty` is the one that matters: Step 733/F3b already retries once
 * on an empty result precisely because a Voyage 429 or a Firestore blip makes
 * `retrieveContext` fail open to zero chunks and read as a confident "no
 * match". Recording it is what turns "is one retry enough?" from a guess into
 * a number.
 */
export type MoiNoCandidateReason =
  /** Step 830 — a bulk material or a labour line; never searched, correctly. */
  | "not_a_product"
  /** Retrieval returned zero chunks even after its retry. A FAILURE, usually. */
  | "retrieval_empty"
  /** Chunks were found and the judge rejected every one as not a product. */
  | "judge_rejected_all";

/** Step 831 — one candidate as the judge saw it, truncated for storage. */
export interface MoiShortlistChunk {
  filename: string;
  text: string;
}

/**
 * How many items per run keep their shortlist, and how much of each chunk.
 * 5 x 6 x 400 chars is ~12 KB — a rounding error against the 1 MiB doc, and
 * enough to replay a judge call exactly.
 */
export const MOI_SHORTLIST_SAMPLE_ITEMS = 5;
export const MOI_SHORTLIST_CHUNK_CHARS = 400;

export interface MoiThresholds {
  /** Below this %, a candidate isn't a match. */
  no_match_below: number;
  /** Show every candidate within this many points of the best match. */
  group_within: number;
}

/** The full structured result stored on the run doc (language-neutral). */
export interface MoiResult {
  items: MoiResultItem[];
  /** Items found in the file before the cap. */
  total_count: number;
  /** Items actually matched (≤ cap). */
  processed_count: number;
  capped: boolean;
  /** Threshold snapshot at run time (the card's initial view). */
  run_thresholds: MoiThresholds;
  /** Runner's preferred_language (reason language + initial header language). */
  lang: string;
}

/** MOI run lifecycle, on the agentRuns doc. Distinct from the transform agents'
 *  running/complete/error because MOI has an extract → confirm → match flow. */
export type MoiRunStatus =
  | "extracting"
  | "awaiting_confirmation"
  | "matching"
  | "complete"
  | "error"
  | "cancelled";

/**
 * Threshold defaults (percentage points, best-anchored).
 *
 * ⚠️ Step 913 — NO LONGER USER-OVERRIDABLE. The comment here has been stale
 * twice: the /agents ALT tab became a card popup in Step 450, and that popup is
 * now gone too. `users/{uid}.moi_settings` survives and is still read per run,
 * so these are OPERATOR settings edited against the user doc — the pattern Step
 * 897 established for `opcond_rule`, which lives in the same map.
 */
/**
 * Step 843 — the match floor, set from the JUDGE'S OWN RUBRIC rather than from
 * a gap in a histogram, because the distribution has no gap: 21 items at
 * 80-100, 11 at 60-79, 12 at 40-59 on the operator's 112-line tender declines
 * smoothly.
 *
 * The rubric draws the line itself:
 *   70-89  same type AND matching key specifications
 *   40-69  "same category but SOME KEY SPECS DIFFER"
 *
 * For a procurement list a product whose key specs differ is not a substitute —
 * it is a lead. 70 is where the judge stops saying "close" and starts saying
 * "this one would do", so that is the floor.
 *
 * The measured behaviour agrees: across sampled items every winner retrieval
 * ranked FIRST scored 85%, and every winner dredged from rank 5 scored ≤40%.
 * The floor separates those two populations, and nothing sat between them.
 *
 * ⚠️ 10 was right for the job MOI used to do — surface options for a human, hide
 * nothing. Since Step 832 the card DROPS a line with no qualifying match, so the
 * floor now decides what a user never sees, which is a different and much
 * heavier responsibility.
 *
 * ⚠️ Thresholds are stored PER RUN and applied at VIEW time, so this changes new
 * runs only; an existing result keeps the floor it was matched under. Tunable
 * without a deploy via MOI_MIN_CONFIDENCE.
 *
 * ⚠️ Step 858 — LOWERED 70 -> 30, and the reasoning above is what changed, not
 * the arithmetic. It was derived from the RUBRIC ("40-69 = some key specs
 * differ, which is a lead, not a substitute") because the score histogram had no
 * gap to derive it from. That was the best available argument at the time; it is
 * not what the operator's labels say.
 *
 * Swept against 36 labelled rows (25 ok / 11 wrong), judged fresh with every
 * Step 852-857 fix live:
 *
 *     thr   shown   ok   wrong   precision   recall
 *      30     14    13     1        93%        52%
 *      50      9     8     1        89%        32%
 *      70      6     5     1        83%        20%
 *
 * Lowering it more than DOUBLES the correct matches and RAISES precision. The
 * shape is the point: the one wrong match sits high while many correct ones sit
 * at 30-60, so a tight floor filters out mostly good matches. That is Step 852
 * working — the confidently-wrong names it removed were exactly the population
 * a high floor used to be protecting against.
 *
 * ⚠️ The rubric argument still holds for what a 40-69 score MEANS. What the
 * labels overturn is the assumption that a buyer is better served by seeing
 * nothing than by seeing a lead: at 70 this tender showed 5 of 25 findable
 * matches. Re-sweep before moving it again — `lib/agents/moi/eval/luna-judge-compare.ts`.
 */
const MIN_CONFIDENCE = (() => {
  const n = Number(process.env.MOI_MIN_CONFIDENCE);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.floor(n) : 30;
})();

export const MOI_DEFAULT_THRESHOLDS: MoiThresholds = {
  no_match_below: MIN_CONFIDENCE,
  group_within: 5,
};

/**
 * Chunks shortlisted + scored by the judge per source item.
 *
 * Step 844 — 6 → 4, and it is the largest token line in a run: the judge's
 * input is this many chunks of catalogue text, once per item.
 *
 * P1-6 widened it 3 → 6 so the Step-458 product dedup would still yield several
 * DISTINCT products for the alternatives grouping. Measured across 187 real
 * items, that is not what happens: the judge returned more than four distinct
 * candidates for **11 of them (6%)**. Six chunks routinely collapse to four or
 * fewer once the dedup and the not-a-product rule have run, so ranks 5-6 were
 * mostly paying to be discarded.
 *
 * The Step-843 floor is the other half of the argument. Every winner that
 * retrieval ranked FIRST scored 85%; every winner dredged from rank 5 scored
 * ≤40% — below the floor, so already dropped. A shorter shortlist cannot lose a
 * match that would have been shown.
 *
 * ⚠️ The residual is the 17% of shown items that carry ALTERNATIVES: if one of
 * those came from chunk 5 or 6, that alternative goes. Bounded by the 6% above,
 * and `MOI_TOP_K_ENV` walks it back to 5 or 6 without a deploy.
 *
 * ⚠️ Step 886 — RAISED 4 -> 8, because the argument above EXPIRED.
 *
 * Its load-bearing claim was "every winner dredged from rank 5 scored <=40% —
 * below the floor, so already dropped. A shorter shortlist cannot lose a match
 * that would have been shown." That was true when the floor was 70. Step 858
 * then lowered the floor to 30 and put exactly those winners ABOVE it, and
 * nobody re-swept the shortlist against the new floor.
 *
 * Re-swept on the operator's 36 labelled rows, scoring a HIT only when the arm
 * picks the product the OPERATOR picked, each configuration run three times
 * (all three byte-identical — the judge is deterministic since Step 872 and the
 * rewrite is pinned by the Step-877 cache):
 *
 *     K=4  (was)   HIT  3   OTHER 10   MISS 12   FALSE 1   shown 14
 *     K=6          HIT  5   OTHER  7   MISS 13   FALSE 3   shown 15
 *     K=8  (now)   HIT  6   OTHER  9   MISS 10   FALSE 1   shown 16
 *     K=10         HIT  6   OTHER  9   MISS 10   FALSE 4   shown 19
 *     K=12         HIT  3   OTHER  9   MISS 13   FALSE 3   shown 15
 *
 * K=8 DOUBLES the verified matches at an unchanged false-match count. K=10 buys
 * no extra hits and quadruples FALSE — more candidates past this point dilute
 * the judge rather than inform it, which is the same effect Step 844 saw from
 * the other side. So the optimum is a peak, not a ceiling: do not read this as
 * "more is better" and raise it again without re-sweeping.
 *
 * COST: the judge's billed tokens rise 345 -> 511 per item (+48%), the only
 * line that moves — the reranker scores the same pool either way. A wrong or
 * missing line on a tender costs the buyer far more than 166 tokens.
 *
 * ⚠️ The floor was re-swept at K=8 too and 30 still holds: HIT is flat at 6
 * from thr 10 through 40 and falls at 50, so Step 858's floor is not what
 * limits recall here. Only ONE variable moved.
 *
 * ⚠️ Step 894 — RE-SWEPT UNDER SELF-CONSISTENCY (Step 892 made averaging two
 * orders the default, which changes the score distribution, so a depth tuned to
 * the old one needed re-checking). **K STAYS AT 8.** Full document, one process
 * per arm, `MOI_RERANK_TOP_N = K+2` so ranked depth is never the binding
 * constraint:
 *
 *     K=4    82 shown   67 scoring >=70
 *     K=6    80 shown   68
 *     K=8    90 shown   75      <- shipped; third repeat of 90 shown
 *     K=10   95 shown   76
 *     K=12  104 shown   71      <- dilution: +14 shown, -4 strong
 *
 * The peak did not move. K=10's extra five lines are ALL in the weak 30-69 band
 * (19 vs 15) with strong flat inside its ±2 repeat variance, and on the operator's
 * labelled rows — re-run after correcting the harness to diversify the shortlist
 * the way match.ts does — K=8 scores HIT 8 / FALSE 5 against K=10's HIT 7 /
 * FALSE 4. One item each way, inside the precision this set supports, so K=8 keeps
 * it. Changing a shipped dial on a one-item difference is the over-reading the
 * attribution note above warns about.
 *
 * ⚠️ RETRACTED. This first claimed averaging "neutralised the false-match penalty
 * that rejected K=10" (FALSE 1->4 batched vs 4->3 averaged). Those ledgers were
 * built by a harness doing a plain `.slice` instead of `diversifyShortlist`, i.e.
 * a shortlist production has not built since Step 891. Re-measured correctly,
 * K=10 is FALSE 4 against K=8's 5 — a one-item difference, not a neutralised
 * penalty. Step 886's own "K=10 quadruples FALSE" is also a pre-diversity number
 * and has NOT been redone; treat the depth-vs-false-match interaction as unmeasured
 * rather than as either result.
 *
 * The DISPLAY FLOOR was re-swept on the same stored runs (free — MOI thresholds
 * are view-time) and 30 still wins: at K=8 raising it to 40 costs a HIT to save
 * two FALSE, and 50 costs five HIT to save the same two. HIT collapses between 40
 * and 50 under averaging, so 30 is not merely inherited, it is measured.
 *
 * ⚠️ Step 892 — WHAT THIS SWEEP CAN AND CANNOT ATTRIBUTE. The judge scores every
 * candidate in ONE call, so the SET is the prompt and a verdict is a property of
 * the NEIGHBOURHOOD. Measured on the operator's 158 items, swapping candidates 1
 * and 2 — identical set, only their order differs, nothing the judge is asked to
 * reason about changed — moved the chosen product on **40%** of items and the
 * buyer-visible outcome on **10%**.
 *
 * That does NOT make the table above noisy, and it is worth being exact about
 * why: two runs of the SAME config over the same 158 items agree to ±1 shown
 * (84 vs 85), with the score moving on 3% of items and the floor crossed on 0%.
 * Repeats are reproducible; "all three byte-identical" above is real.
 *
 * What it costs is ATTRIBUTION. Every knob in this file — K, the rerank cut, the
 * per-product cap, the protected head — changes the shortlist's composition, and
 * composition alone moves 40% of picks. So a measured gain is a mixture of
 * "better candidates were available" and "they were arranged differently", and
 * the aggregate cannot separate them. Read the sweep as evidence that K=8 is the
 * better CONFIGURATION (75 -> 84 shown on the full document is far outside the
 * ±1 repeat band), not as evidence about how depth works.
 *
 * The one-per-candidate call shape that would remove the confound was built and
 * measured — it is worse, badly. See `judge-merge.ts`.
 */
/** PURE, so `eval:moi-depth` can assert the clamp without re-importing the
 *  module — a constant resolved at module load cannot be re-read under a
 *  different env, and an eval that tries produces vacuous passes. */
export function resolveMoiTopK(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? Math.floor(n) : 4;
}
export const MOI_TOP_K = resolveMoiTopK(process.env.MOI_TOP_K_ENV);

/**
 * Step 886 — how many candidates the reranker RETURNS for a MOI match query.
 *
 * Widening the judge's shortlist alone does not work: at the chat-wide cut of 5
 * the extra candidates come from sibling expansion (chunks physically adjacent
 * to a winner) rather than from the reranker's own ranks, and measured on the
 * same 36 rows that tripled false matches (FALSE 1 -> 3) while losing a correct
 * one. The depth has to be RANKED depth.
 *
 * Costs no extra rerank tokens — `topN` decides how many of an already-scored
 * pool come back, not how many are scored. Chat keeps `FINAL_TOP_N_RERANKED`.
 */
/** PURE — see resolveMoiTopK. */
export function resolveMoiRerankTopN(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 30 ? Math.floor(n) : 6;
}
export const MOI_RERANK_TOP_N = resolveMoiRerankTopN(process.env.MOI_RERANK_TOP_N);

/**
 * Step 891 — how many shortlist slots ONE product may occupy.
 *
 * See product-key.ts. A rubric rule for the same defect was measured and
 * declined (Step 890, judge-prompt.ts); this changes which products are
 * offered rather than how strictly each is judged, so it cannot make the judge
 * globally more suspicious the way that rule did.
 *
 * Set to 0 to disable entirely.
 */
export function resolveMoiPerProductCap(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 12 ? Math.floor(n) : 2;
}
export const MOI_PER_PRODUCT_CAP = resolveMoiPerProductCap(process.env.MOI_PER_PRODUCT_CAP);

/** Step 891 — leading candidates the per-product cap may NOT reorder. */
export function resolveMoiProtectTop(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 8 ? Math.floor(n) : 2;
}
export const MOI_PROTECT_TOP = resolveMoiProtectTop(process.env.MOI_PROTECT_TOP);

/** Default per-run item cap (env `MOI_MAX_ITEMS` overrides, server-side). The
 *  real constraint is per-run cost (1 retrieval + 1 judge call per item). */
export const MOI_MAX_ITEMS_DEFAULT = 50;

/**
 * Step 816 — how many distinct items GATHER will accumulate from one document.
 *
 * Deliberately SEPARATE from MOI_MAX_ITEMS_DEFAULT, which caps what the MATCH
 * stage will process. Reading is cheap and batched; matching is one retrieval
 * plus one judge per item against a 300s ceiling. Keeping them apart is what
 * lets the card say "found 300, matching the first 50" — honest — instead of
 * either lying about the document or starting a run that cannot finish.
 *
 * The operator sized real cases at 500 items; raising the MATCH cap to meet it
 * needs run continuation and result storage off the run doc first.
 */
export const MOI_GATHER_MAX_ITEMS = (() => {
  const n = Number(process.env.MOI_GATHER_MAX_ITEMS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
})();

/**
 * Rough billed-tokens-per-item for the MATCH stage, shown on the confirm card
 * as a pre-commit estimate (itemCount × this). The user is billed the ACTUAL
 * run tokens; this only sets the expectation.
 *
 * ⚠️ Step 873 (audit A5) — 1000 → 400, and it had been wrong by 2.7× since a
 * day of cost work moved every input to it. Its own comment asked to be
 * re-measured "if the shortlist size or judge model changes", and since then:
 * `reason` dropped (857), thinking → MINIMAL (869), the candidate cap halved
 * (871), per-model discounts landed (872), and the code fast-path made some rows
 * free (870). Measured on the operator's 158-row prod run: **369 billed per
 * judged item**, 0 for the 10 code-fast-pathed rows, ≈345 averaged over the run.
 *
 * 400 is deliberately a little ABOVE the measurement — for a price shown before
 * someone commits, over-stating is the safe direction. But 2.7× over is not
 * "safe", it is a deterrent on a cost-sensitive run, which is what this was.
 *
 * Re-measure from the `[moi/judge]` log line (Step 849), which prints the raw
 * and billed split per call, whenever the judge model, its thinking level, the
 * candidate cap or the discount table moves.
 *
 * ⚠️ Step 892 — 400 → 1200, because SELF-CONSISTENCY judges every set TWICE
 * (`judge.ts`). Measured on the same 158-row document: **1114 billed per judged
 * item**, 1023 averaged over the run including the code-fast-pathed rows — so 400
 * would now understate by 2.8×, and understating a pre-commit price is the unsafe
 * direction. 1200 keeps the deliberate small margin above the measurement.
 *
 * If `MOI_SELF_CONSISTENT=false` is ever set, this over-states by ~2×. That is
 * the correct way round for a number shown before someone commits, and the flag
 * is a rollback lever rather than a supported configuration.
 *
 * ⚠️ Step 907 — 700 → 400, and the basis now has TWO lines. K dropped to 4 (judge
 * 345 billed per judged item, 115 of 158 rows judged ≈ 39,700 a run) and the
 * RERANKER became a user charge for the first time (~3.09M raw ÷ 240 ≈ 12,900 a
 * run). Together ~52,600 over 158 source items ≈ **333 each**; 400 keeps the
 * deliberate margin above the measurement.
 *
 * ⚠️ The rerank half does NOT scale with K — the reranker scores the whole pool
 * whatever `topN` returns — so tuning K moves only the judge half of this number.
 */
export const MOI_TOKENS_PER_ITEM_ESTIMATE = 400;

/**
 * Step 1117 (audit M5 / F11) — what READING one page of a PDF costs, for the
 * gate and the refusal message. The gather is OCR on every page (469 billed at
 * the Step-915 lever) plus one model call per page (the 3,122-token extraction
 * prompt, the page's text, the rows it returns), so a page is the unit the way
 * a line is the unit of the match.
 *
 * ⚠️ MEASURED, not derived: three gathers of the operator's 47-page tender
 * (`13 TS.pdf`, prod, gather only — the run sat at `awaiting_confirmation`)
 * billed 31,501 / 32,954 / 34,276 → **670-730 a page**. 900 keeps the same
 * kind of margin `MOI_TOKENS_PER_ITEM_ESTIMATE` keeps over 333. A DENSE page
 * (2,500 tokens of text, 1,500 of rows) prices at ~2,200 through
 * `extractionBilledTokens`, so a document of nothing but full tables will
 * overshoot the estimate — the user is billed the actual usage either way, and
 * a number shown before someone commits should err low rather than refuse a
 * run they could afford.
 *
 * An IMAGE is one page. A text document (docx / xlsx / csv) is not gated on
 * this: it has no pages, its read is bounded by `GATHER_MAX_TEXT_CHARS`, and
 * the same 158-line tender as a Word file billed 14,160 against ~33,000 as a
 * PDF — the PDF is the cost the gate exists for.
 */
export const MOI_TOKENS_PER_PAGE_ESTIMATE = 900;

/**
 * Size ceiling for a file the model must read INLINE — PDFs and images.
 * (Step 738 / IPL audit R3. Shared by MOI and IPL, client and server.)
 *
 * A PDF/image is sent to Gemini as `inlineData`, i.e. BASE64 inside the JSON
 * request, and base64 inflates by 4/3. The API's inline request ceiling is 20 MB,
 * so the largest binary that can fit is exactly 15.00 MB — before the prompt and
 * the JSON envelope. Storage rules allowed 25 MB, so anything from ~15 to 25 MB
 * uploaded happily and then failed inside the extraction call, surfacing as the
 * generic "Couldn't read the items."
 *
 * 14 MB leaves headroom for that envelope. It is deliberately a round number
 * BELOW the true ceiling: a file at 14.6 MB might squeak through today, and a
 * limit that sometimes works is worse than one that always tells you.
 *
 * The TEXT formats (xlsx / docx / csv) are unaffected — they are parsed locally
 * and truncated to 50k chars, never inlined — so they keep the 25 MB rule.
 */
export const MOI_MAX_INLINE_BYTES = 14 * 1024 * 1024;

/**
 * The ONE place the size limit is explained, so the client pre-flight and the
 * server gate cannot say different things. Names the actual size, the limit, and
 * what to do about it — a bare "too large" leaves the user guessing which of
 * their files is the problem and by how much.
 */
export function oversizeMessage(bytes: number): string {
  const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `This image is ${mb(bytes)}. Images have to be under ${mb(MOI_MAX_INLINE_BYTES)} because the model reads them whole. Export it at a lower resolution.`;
}

/**
 * Step 1066 — the same limit, but for ONE PAGE of a PDF.
 *
 * ⚠️ A PDF IS NO LONGER SENT WHOLE, and the old message said it was. Since Step
 * 816 `splitPdfPages` cuts the file into page batches BEFORE any request, so
 * only a batch is ever base64'd — the cap belongs to the batch, and a message
 * that blames "this file" sends the user to shrink 171 pages when one of them
 * is the problem.
 *
 * Names the PAGE, because that is the actionable part: the file cannot be
 * exported at a lower resolution to fix one scanned insert, but it can be split.
 */
export function oversizePageMessage(firstPage: number, pageCount: number, bytes: number): string {
  const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
  const where =
    pageCount > 1
      ? `Pages ${firstPage}-${firstPage + pageCount - 1} of this PDF are`
      : `Page ${firstPage} of this PDF is`;
  return `${where} ${mb(bytes)}. A single page has to be under ${mb(MOI_MAX_INLINE_BYTES)} because the model reads it whole. Split the file, or re-export that page at a lower resolution.`;
}

/**
 * Thrown by BOTH the client pre-flight and the server gate, so one `instanceof`
 * tells every caller "this is the known, explainable failure — show its message"
 * rather than falling back to a generic line. Lives here (not in the server-only
 * extract module) precisely so the client can throw it too.
 */
export class MoiInputTooLargeError extends Error {
  readonly userFacing = true;
}

/** Does this mime go to the model as inline base64 (vs. local text extraction)? */
export function isInlineMimeType(mimeType: string): boolean {
  return mimeType === "application/pdf" || mimeType.startsWith("image/");
}

/**
 * Step 1066 — is the WHOLE FILE one request payload?
 *
 * ⚠️ THIS IS THE QUESTION `MOI_MAX_INLINE_BYTES` ACTUALLY ASKS, and until now it
 * was asked as `isInlineMimeType`, which answers something else. Both PDFs and
 * images are sent as inline base64 — but since Step 816 a PDF is split into page
 * batches BEFORE any request, so what reaches the API is a BATCH. The whole-file
 * cap was guarding a quantity that stopped existing, and it refused a real
 * 19.2 MB / 171-page design document whose batches are ~450 KB each.
 *
 * An image has no such split: the file IS the payload, so the cap is right there
 * and stays.
 *
 * ⚠️ `isInlineMimeType` is deliberately UNCHANGED — it is still correct for the
 * legacy single-call `extractItems`, which really does send a whole PDF in one
 * request. Narrowing the shared predicate would have quietly broken that path's
 * guard instead of fixing this one.
 */
export function sendsWholeFileInline(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

/**
 * Step 1066 — the first page batch that is too large to send, or null.
 *
 * PURE and structurally typed (no `Buffer`) so `eval:gather-bounds` can execute
 * the real decision rather than a mirror of it — the `shouldRetrySmaller` /
 * `detectRowShortfall` shape this module already follows.
 *
 * ⚠️ FIRST, not "all of them": the caller refuses the run, so one is enough, and
 * naming the earliest is what a user checking their own document expects.
 */
export function findOversizeBatch<T extends { firstPage: number; pageCount: number }>(
  chunks: ReadonlyArray<T & { pdf: { byteLength: number } }>,
): { firstPage: number; pageCount: number; bytes: number } | null {
  for (const c of chunks) {
    if (c.pdf.byteLength > MOI_MAX_INLINE_BYTES) {
      return { firstPage: c.firstPage, pageCount: c.pageCount, bytes: c.pdf.byteLength };
    }
  }
  return null;
}

/** Accepted source-file types (mirrors processFileExtraction's Document +
 *  Image inputs): docx / xlsx / pdf / csv + images. */
export const MOI_ACCEPT =
  ".pdf,.docx,.xlsx,.csv,image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";

/**
 * Step 1159 — the storage rule's caps on `moi-uploads/` (`storage.rules`), stated
 * ONCE for the client: an image under 5 MB, every other format under 25 MB (the
 * extract route and the engine re-state 25 MB for the download they make).
 *
 * The upload zone PRINTS these and the pre-flight ENFORCES them, so the text, the
 * check and the rule cannot say three different things. ⚠️ Until this step the
 * client checked images against `MOI_MAX_INLINE_BYTES` (14 MB, the MODEL's cap),
 * so a 6-14 MB photo passed the pre-flight, was refused by the rule, and surfaced
 * as a bare "Couldn't upload that file." `verify-step-1159` reads both numbers
 * out of `storage.rules`, so moving one without the other goes red.
 */
export const MOI_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MOI_MAX_FILE_BYTES = 25 * 1024 * 1024;

/** A limit as the upload zone prints it: `5 MB`, `25 MB`. */
export function formatUploadLimit(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Step 1159 — why this size cannot be uploaded, or null when it fits. Names the
 * file's size, the limit and what to do (the `oversizeMessage` rule). ⚠️ The
 * storage rule is `size < limit`, so a file of EXACTLY the limit is refused here
 * too — the check must not admit what the rule then refuses.
 */
export function uploadSizeProblem(bytes: number, mimeType: string): string | null {
  const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (mimeType.startsWith("image/")) {
    return bytes >= MOI_MAX_IMAGE_BYTES
      ? `This image is ${mb(bytes)}. Images have to be under ${formatUploadLimit(MOI_MAX_IMAGE_BYTES)} — export it at a lower resolution, or save the list as a PDF.`
      : null;
  }
  return bytes >= MOI_MAX_FILE_BYTES
    ? `This file is ${mb(bytes)}. Files have to be under ${formatUploadLimit(MOI_MAX_FILE_BYTES)} — split it into smaller files, or export it without the pictures.`
    : null;
}

/**
 * Step 1159 — does `MOI_ACCEPT` admit this file? A DROP bypasses the input's
 * `accept` attribute, so the drop zone asks this. ⚠️ PARSED FROM `MOI_ACCEPT`
 * ITSELF — extensions (`.pdf`), wildcards (`image/*`) and exact types — so the
 * picker and the drop can never admit different things. `mimeType` is the
 * caller's resolved type (`file.type`, else the extension's), since a drop out
 * of some apps carries an empty `file.type` (the Step-1115 note).
 */
export function acceptsMoiFile(name: string, mimeType: string): boolean {
  const ext = (/\.([a-z0-9]+)$/i.exec(name.trim())?.[1] ?? "").toLowerCase();
  const type = mimeType.toLowerCase();
  return MOI_ACCEPT.split(",").some((raw) => {
    const token = raw.trim().toLowerCase();
    if (token.startsWith(".")) return ext !== "" && `.${ext}` === token;
    if (token.endsWith("/*")) return type.startsWith(token.slice(0, -1));
    return type !== "" && type === token;
  });
}

/** Step 1159 — what a drop zone says when the file is not one it can read. */
export const MOI_UNSUPPORTED_FILE_MESSAGE =
  "That file type can't be read here. Use a PDF, a Word (.docx), Excel (.xlsx) or CSV file, or an image.";

/** Step 1159 — what a drop zone says when more than one file is dropped. */
export const MOI_ONE_FILE_MESSAGE = "One file at a time — drop a single list of materials.";
