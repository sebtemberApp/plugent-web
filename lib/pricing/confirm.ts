/**
 * What the CONFIRM step needs — pure and client-safe (its one value import,
 * `hasStatedQuantity`, is pure too).
 *
 * Three halves now, all about the moment between "we read your file" and "price
 * it": what the card SHOWS about the read, which lines it starts TICKED, and
 * what the user SENDS back.
 *
 * ## ⚠️ THE COVERAGE WAS STORED AND READ BY NOBODY
 *
 * `extractPricingItems` has persisted `total_count`, `gather_position_gaps`,
 * `gather_shortfall` and `gather_missing_positions` since Steps 816/822/898 —
 * Step 822's own comment says they exist "so the surface can ask the user to
 * check a numbered row we never returned". `MoiRunCard` reads them. The PRICING
 * card read NONE of them, so a 158-line tender read down to 25 rows announced
 * "Found 25 lines." with total confidence.
 *
 * That is the same class as Step 1032's paused-run flag and Step 804's dropped
 * `reason`: a signal the system already holds never reaching the place that
 * decides.
 *
 * ## ⚠️ AND IT LIVES HERE BECAUSE THERE ARE THREE READERS
 *
 * The pricing page (server-rendered initial state), the pricing listener, and
 * `MoiRunCard`. Three hand-copies of the same defensive parse is how they
 * drift; `sidebar-row.ts` is this repo's most recent lesson in that.
 */
import { displayUnit, hasStatedQuantity } from "@/lib/agents/ipl/derive";
import type { MoiSourceItem } from "@/lib/agents/moi/types";

/** How much of the document the read actually covered. */
export interface PricingCoverage {
  /**
   * Lines the file held BEFORE the per-run cap. Falls back to the read count,
   * so a document with no stored total renders "Found N lines" exactly as it
   * did before this existed.
   */
  totalCount: number;
  /**
   * Positions the document NUMBERS but the read did not return (Step 822).
   * The document's own checksum — the only completeness signal that does not
   * require the user to already know the answer.
   */
  missingPositions: string[];
  /** Step 898 — the document declares more buyable rows than were read. */
  shortfall: { expected: number; got: number; missing: number } | null;
  /**
   * Audit F5 — the gather stopped on its own wall-clock budget with segments
   * unread.
   *
   * ⚠️ When this is set, `totalCount` is what we MANAGED TO READ, not what the
   * file held — every other field here assumes the whole document was seen.
   * A surface must say so rather than render the usual line.
   */
  stoppedEarly: { read: number; total: number; unit: "page" | "chunk" } | null;
}

const EMPTY: PricingCoverage = {
  totalCount: 0,
  missingPositions: [],
  shortfall: null,
  stoppedEarly: null,
};

/**
 * Read the coverage block off a run document.
 *
 * Defensive throughout: every field is optional on older documents, and a
 * malformed one must degrade to "nothing to say" rather than throw inside a
 * snapshot handler.
 */
export function readPricingCoverage(
  data: Record<string, unknown> | null | undefined,
  readCount: number,
): PricingCoverage {
  if (!data) return { ...EMPTY, totalCount: readCount };

  const total = typeof data.total_count === "number" ? data.total_count : 0;

  const gaps = Array.isArray(data.gather_position_gaps)
    ? (data.gather_position_gaps as Array<{ missing?: unknown }>).flatMap((g) =>
        g && Array.isArray(g.missing) ? (g.missing as unknown[]).filter(isNonEmptyString) : [],
      )
    : [];

  const sf = data.gather_shortfall as Record<string, unknown> | null | undefined;
  const num = (k: string) => (sf && typeof sf[k] === "number" ? (sf[k] as number) : 0);
  // ⚠️ Only a POSITIVE shortfall is a shortfall. A healthy run stores
  // `{expected, got, missing: 0}`, and rendering that would tell every user
  // that 0 rows may be missing — a warning nobody would read twice.
  const shortfall =
    num("missing") > 0
      ? { expected: num("expected"), got: num("got"), missing: num("missing") }
      : null;

  // Audit F5 — the gather stopped on its own budget. ⚠️ Absent on every run
  // written before F5 AND on every complete run, so `null` must read as "not
  // stopped" rather than "unknown" — the same degrade rule `requested_count`
  // and `noMatchReason` already follow.
  const se = data.gather_stopped_early as Record<string, unknown> | null | undefined;
  const stoppedEarly =
    se && typeof se.read === "number" && typeof se.total === "number" && se.total > se.read
      ? {
          read: se.read as number,
          total: se.total as number,
          unit: se.unit === "page" ? ("page" as const) : ("chunk" as const),
        }
      : null;

  return {
    // A stored total BELOW the read count is not a total — a partial write or
    // an older document. The read count is the floor either way.
    totalCount: Math.max(total, readCount),
    missingPositions: gaps,
    shortfall,
    stoppedEarly,
  };
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Narrow the confirmed list to what the user kept.
 *
 * ⚠️ `undefined` and `[]` MEAN DIFFERENT THINGS and the caller depends on it:
 * `undefined` is "no selection was sent" (an older client, or a continuation)
 * and prices everything — today's behaviour; `[]` is "the user unticked every
 * line", which the claim must REFUSE rather than silently price the lot.
 *
 * Indices, not names: a bill of quantities repeats `name|code` across sizes —
 * four valve sizes share one name — which is exactly why `MoiResultRow` keys on
 * the index. Selecting by name would take four rows when the user took one.
 */
export function selectKeptItems<T>(all: T[], keep: number[] | undefined): T[] {
  if (!keep) return all;
  const wanted = new Set(keep);
  // Filtering by position also drops an out-of-range or duplicated index for
  // free, so a malformed selection narrows rather than throws.
  return all.filter((_, i) => wanted.has(i));
}

/** A client-supplied selection, validated into something safe to filter with. */
export function parseKeepIndices(raw: unknown, max: number): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < max) out.push(v);
    // Anything else is dropped rather than rejected: the selection can only
    // ever NARROW the run, so a junk index costs the caller a line, not us.
    if (out.length > max) break;
  }
  return out;
}

/**
 * What the gather is doing right now — Step 1098.
 *
 * ⚠️ A THIRD READER IS WHY THIS IS HERE and not parsed at each call site. The
 * server page and the listener both need it, and `readPricingCoverage` above
 * records what happens otherwise: "three hand-copies of the same defensive
 * parse is how they drift".
 *
 * ⚠️ EVERY FIELD IS CHECKED, and a malformed block degrades to NULL rather than
 * to a partial object. This renders a progress bar — a `total` of 0 with a
 * `done` of 12 would divide into an infinite width, and a bad `phase` would
 * fall through every label. Null means "no bar", which is the pre-1098 display
 * and correct for every run that predates the field.
 */
export interface GatherProgress {
  phase: "preparing" | "scanning" | "assembling";
  done: number;
  total: number;
  unit: "page" | "chunk";
}

const GATHER_PHASES = ["preparing", "scanning", "assembling"] as const;

export function readGatherProgress(
  data: Record<string, unknown> | null | undefined,
): GatherProgress | null {
  const raw = data?.gather_progress;
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  const phase = GATHER_PHASES.find((v) => v === p.phase);
  if (!phase) return null;
  const done = typeof p.done === "number" && Number.isFinite(p.done) ? Math.max(0, p.done) : 0;
  const total = typeof p.total === "number" && Number.isFinite(p.total) ? Math.max(0, p.total) : 0;
  return {
    phase,
    // ⚠️ CLAMPED to the total. The gather converts batches to pages with
    // `PAGE_BATCH`, so a final batch covering fewer pages than the batch size
    // can overshoot — and a bar past 100% reads as a bug in the count rather
    // than a rounding artefact.
    done: total > 0 ? Math.min(done, total) : done,
    total,
    unit: p.unit === "page" ? "page" : "chunk",
  };
}

/**
 * Which lines the LAST run was for — Step 1095.
 *
 * ## ⚠️ THE STORED LIST USED TO BE THE ANSWER, AND THAT IS WHAT CHANGED
 *
 * Step 1033's claim NARROWED `source_items` to the kept indices, so after a run
 * the confirm list was the selection and this field was unnecessary. That was
 * right while the confirm step was a one-way door. It is wrong now that the
 * stepper can go BACK to it: the lines the user unticked would be gone from the
 * document, so the one change a returning user most wants to make — "I unticked
 * that by mistake" — was the one change impossible to make.
 *
 * ⚠️ AND IT QUIETLY BROKE STEP 1064's EXPORT RULE. That step's own comment says
 * the XLS "exports what was READ, never the selection ... dropping the unticked
 * lines would delete rows the reader can see in their own document" — while the
 * claim was deleting exactly those rows from the array the export reads. The
 * export is now what it says it is again.
 *
 * ⚠️ NULL MEANS "EVERYTHING", and it has to, because that is also what every
 * run written before this means: their stored array IS the narrowed one, so
 * "select all of it" reproduces their behaviour exactly. A reader that treated
 * absent as "nothing selected" would show a historical run with every box
 * unticked.
 */
export function readRequestedIndices(
  data: Record<string, unknown> | null | undefined,
): number[] | null {
  const raw = data?.requested_indices;
  if (!Array.isArray(raw)) return null;
  const out = raw.filter(
    (v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0,
  );
  // ⚠️ An EMPTY stored array is not "price nothing" — the claim refuses that
  // (Step 1033), so it can only be a malformed document. Degrading to null
  // shows every line ticked, which is recoverable; showing none is a card the
  // user cannot move past.
  return out.length > 0 ? out : null;
}

/**
 * The confirm step's unticked set, restored from what the last run was for.
 *
 * ⚠️ PURE, so the eval can execute it: this mapping is invisible in a
 * screenshot and in a source check, and getting it wrong re-prices lines the
 * user had removed. `visibleConfirmRows` decides what is on screen at all; this
 * decides which of those arrive ticked.
 */
export function droppedFromRequested(
  all: readonly ConfirmItem[],
  requested: number[] | null,
): Set<number> {
  if (!requested) return new Set();
  const kept = new Set(requested);
  const out = new Set<number>();
  for (let i = 0; i < all.length; i++) if (!kept.has(i)) out.add(i);
  return out;
}

/** Just the shape the confirm list needs, so callers can stay type-safe. */
export type ConfirmItem = MoiSourceItem;

/**
 * Does this line carry ANYTHING a buyer could act on?
 *
 * ## ⚠️ Step 1067 — the contents page came back as 14 items
 *
 * Measured on a real prod run (`13 TS.pdf`, 142 items): rows 1-14 were the
 * document's list of project parts — `BENDROJI DALIS`, `ARCHITEKTŪRINĖ DALIS`,
 * codes `SP` / `SA` / `SK` / `LVN` — because the extraction prompt's kind (C)
 * offers `"1."` as a row identifier and then says EVERY ROW IS ITS OWN ITEM.
 * Step 1067 fixes that at the source; this is the deterministic backstop for
 * when the model emits them anyway.
 *
 * A row with NO QUANTITY is general information, not a line to buy. That is the
 * claim, and it is deliberately the ONLY claim: this predicate does not decide a
 * row is "a contents row" or "a specification row", because it cannot know
 * that, and pre-unticking is honest about a guess in a way that deleting would
 * not be.
 *
 * ## ⚠️ Step 1080 — the three-condition rule was REFUTED, by its own evidence
 *
 * This used to require ALL THREE — no quantity AND no unit AND no specification
 * — on a measurement that read: "a quantity test alone flags 30 rows of which
 * SIXTEEN are real — eight Wilo pumps from a schedule with electrical data and
 * no quantity column, plus a heat meter." That measurement counted rows that
 * LOOK like products. It never asked the question that decides the case:
 *
 *     is the SAME product already in the run, on a row that HAS a quantity?
 *
 * ⚠️ IT IS. Measured on prod run `kNaAqXap` (`13 TS.pdf`, 125 items, 15 with no
 * quantity), the no-quantity rows are the SPECIFICATION section's descriptions
 * of items the bill of quantities prices a few rows later:
 *
 *     8 x "Akmens vatos vamzdiniai kevalai"      qty -
 *     8 x "Izoliacija, kevalai vamzdynams"       14.1-14.8  qty 19 15 6 22 24 19 9 26 m'
 *         "Plokštelinis šilumokaitis"            qty -
 *         "Plokštelinis šilumokaitis, vėdinimo"  02.2       qty 1 vnt.
 *         "Šalto vandens skaitiklis"             qty -
 *         "Šalto vandens skaitiklis"             01.2       qty 2 kompl.
 *
 * Eight and eight. Pricing both is pricing the insulation twice.
 *
 * ⚠️ AND STEP 1077 HAD ALREADY REMOVED THE OLD RULE'S BIGGEST ITEM. The eight
 * Wilo pumps it exists to protect are DRAWING CALLOUTS, not a pump schedule —
 * measured there, and dropped at extraction since. So the case for the unit and
 * specification conditions rested on rows that no longer reach this predicate.
 *
 * ⚠️ THE OPERATOR'S RULE, and it is the domain call: if the function cannot
 * find a quantity, the row is general information. A user should not have to go
 * back to the document to hunt for a number the extraction already read on
 * another row.
 *
 * ⚠️ THE SAFETY NET IS UNCHANGED AND IS WHY THIS IS SAFE TO GET WRONG. Flagged
 * rows are pre-UNTICKED, never dropped: they stay listed in document order, one
 * click from being restored, and `defaultDroppedIndices` still fails open when
 * it would take everything. A genuine order line whose quantity the model
 * misread is visible and recoverable, which is exactly the direction a
 * heuristic should fail in.
 */
export function carriesNothingToPrice(item: ConfirmItem): boolean {
  // ⚠️ ONE definition of "has a quantity", shared with `quantityWasAssumed` —
  // whose own Step-815 docblock records that two copies of this test once
  // existed and DISAGREED, so a `quantity: 0` line contributed 1 x price to a
  // total while the card reported nothing assumed. A third copy here would be
  // the same mistake with a longer gap between the answers.
  //
  // ⚠️ It treats 0 and negatives as NOT stated, which is right for this rule
  // too: zero of something is not a purchase.
  return !hasStatedQuantity(item);
}

/**
 * How the quantity reads on the confirm card, unit included.
 *
 * ## ⚠️ Step 1071 — a quantity without its unit is not orderable
 *
 * The card rendered `×1` while `unit` sat on the item, extracted since Step 862,
 * stored, and carried by the export. That step's own note says why it matters:
 * "120 metres of insulation and 120 pieces are different purchases, and the
 * document always says which". Measured on the operator's three real runs, the
 * DOCX has **69 rows counted in `m`** beside 68 in `vnt.` — so the distinction
 * is not hypothetical, and the user approving that list could not see it.
 *
 * ⚠️ **WITH A UNIT, THE DOCUMENT'S OWN FORM WINS: `6 kompl.`, not `×6 kompl.`**
 * The card is checked against the source document line by line, so it should
 * read the way the document reads — the same principle Step 822 applies to a
 * reported gap (`08`, never `8`; `54.` keeps its dot).
 *
 * ⚠️ **WITHOUT ONE IT STAYS `×6`**, because there the `×` is the only thing
 * marking a bare number as a quantity rather than a code or a position. The two
 * forms track a real difference in the data, and the mix is nearly invisible in
 * practice: across 318 real rows, exactly ONE had a quantity and no unit.
 *
 * ⚠️ TRIM-AWARE, and it now has to say why itself: a unit of `" "` is a model
 * writing "absent" the long way, and using it would render a trailing space
 * where the `×` should have been. (This used to cite `carriesNothingToPrice`,
 * which trimmed for the same reason until Step 1080 narrowed it to the
 * quantity alone.)
 *
 * Returns null when there is nothing to show, so the card has ONE rule for both
 * "what does it say" and "does it render at all". ⚠️ A quantity of 0 still
 * renders: it is what the document said, and unlike `hasStatedQuantity` (which
 * answers "may we assume 1?") this only reports.
 */
export function formatQuantity(item: Pick<ConfirmItem, "quantity" | "unit">): string | null {
  const q = item.quantity;
  if (q == null || !Number.isFinite(q)) return null;
  // Step 1122 — `m'` reads as `m` on the card too, the same rule as the
  // sheets, so the card and the file do not spell one unit two ways.
  const unit = displayUnit(typeof item.unit === "string" ? item.unit.trim() : "");
  return unit ? `${q} ${unit}` : `×${q}`;
}

/**
 * The lines the confirm step does not list at all.
 *
 * ## ⚠️ Step 1081 — these are HIDDEN now, not merely unticked
 *
 * Operator's decision, following Step 1080. A row with no quantity is general
 * information, so the card stops showing it: the confirm step is a list of
 * things to buy, and a description of something already priced two rows down
 * is noise in the one place the user is asked to check line by line.
 *
 * ⚠️ THIS CROSSES A LINE STEP 1064 DREW, deliberately and with the consequence
 * handled rather than hidden. That rule said unticking means "do not PAY to
 * price this", never "this is not in my document" — and hiding does say the
 * second thing. So two things carry the honesty the list no longer does:
 *
 *   1. the coverage note NAMES the count, because "Found 125 lines" above a
 *      110-row list is a discrepancy the reader can see and cannot explain;
 *   2. the XLS export still lists EVERY line that was read, with a `Priced`
 *      column — the Step-1064 rule, which is now the recourse rather than a
 *      nicety. A quantity the model misread is recoverable there.
 *
 * ⚠️ FAIL OPEN WHEN IT WOULD TAKE EVERYTHING, and this matters MORE now than it
 * did. An empty selection is REFUSED by the claim (Step 1033), and an empty
 * LIST is a card with nothing on it — so a document every line of which reads
 * as general information would arrive with no way forward at all. Showing the
 * lot and letting the user decide is the safe direction; a heuristic must not
 * be able to lock someone out of their own upload.
 *
 * Returns the EXCLUSIONS rather than the selection because that is what
 * `PricingView` derives from — a run that re-extracts and returns more lines
 * gets the new ones listed rather than silently dropped.
 */
export function defaultDroppedIndices(items: readonly ConfirmItem[]): Set<number> {
  const flagged: number[] = [];
  for (const [i, it] of items.entries()) if (carriesNothingToPrice(it)) flagged.push(i);
  return flagged.length === items.length ? new Set() : new Set(flagged);
}

/**
 * The rows the confirm card lists, each with its CANONICAL index.
 *
 * ⚠️ THE INDEX IS THE WHOLE REASON THIS IS A FUNCTION RATHER THAN A `.filter()`
 * AT THE CALL SITE. A run's `keep` is applied server-side against the STORED
 * `source_items` array (`selectKeptItems`), so the card must speak in indices
 * into THAT array — while the list it renders is a subset. Filter without
 * carrying the indices and every checkbox below a hidden row ticks one line and
 * prices another: silent, and only on documents that happen to have a hidden
 * row above a ticked one.
 *
 * ⚠️ AND IT IS PURE SO THE EVAL CAN EXECUTE IT. This mapping cannot be seen in
 * a screenshot and is not visible in a source check; the only way it gets
 * tested is as a function of plain values.
 *
 * Inherits the fail-open guard: when every row would be hidden, none is, so
 * `items` is never empty while `all` has rows.
 */
export function visibleConfirmRows<T extends ConfirmItem>(
  all: readonly T[],
): { items: T[]; indices: number[] } {
  const hidden = defaultDroppedIndices(all);
  const items: T[] = [];
  const indices: number[] = [];
  for (const [i, it] of all.entries()) {
    if (hidden.has(i)) continue;
    items.push(it);
    indices.push(i);
  }
  return { items, indices };
}

/**
 * The payload a run actually has — audit F1's back-compat rule, in ONE place.
 *
 * ⚠️ NOTHING MIGRATES OLD RUNS, so this fallback is permanent, not transitional:
 * every pricing written before the split keeps `source_items` / `ipl_result` on
 * the summary document and must still render. A reader that only looks at the
 * subcollection looks perfect on a fresh run and silently empties every
 * historical one.
 *
 * ⚠️ SHARED by the server page, PricingView and the driver — the same reasoning
 * as `readPricingCoverage` above ("three hand-copies of this defensive parse is
 * how they drift"), and it also stops the driver testing its own mirror.
 *
 * `fromDoc` is the subcollection document's field; `inline` is the summary's.
 */
export function pickRunPayload<T>(fromDoc: unknown, inline: unknown): T | null {
  if (fromDoc !== undefined && fromDoc !== null) return fromDoc as T;
  if (inline !== undefined && inline !== null) return inline as T;
  return null;
}
