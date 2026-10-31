/**
 * IPL result export (Step 727, PR 4) — build + download the priced table as CSV
 * or XLSX, CLIENT-SIDE from the stored result (no Storage round-trip).
 *
 * Built from the user's SELECTION, so the download is always what the card is
 * showing — untick an option and it leaves the file too.
 *
 * ⚠️ THE EXPORT CARRIES THE GUARDS. A spreadsheet outlives the card and gets
 * forwarded to people who never saw it, so a file that drops the qualifiers is
 * strictly more dangerous than the UI it came from:
 *   - every price is followed by a BASIS cell ("Net EUR"), because a bare
 *     number is ambiguous between net and gross;
 *   - the totals row states coverage ("8/10 priced") next to every figure;
 *   - mixed currencies are separate total rows, never one sum;
 *   - assumed quantities are stated rather than folded in silently;
 *   - a line that contributed MORE THAN ONE price is counted and disclosed.
 *
 * Values stay NUMERIC (not "249.00 EUR") so the sheet is sortable and summable —
 * the qualifier lives in its own column rather than contaminating the number.
 *
 * xlsx (SheetJS) is dynamic-imported only when XLSX is requested, so it stays
 * out of the chat bundle.
 */
import { csvCell } from "@/lib/agents/csv-safe";
import {
  displayUnit,
  type IplNoMatchKind,
  noMatchKind,
  pricedOptionsOf,
  quantityFor,
  quantityWasAssumed,
  summariseSelection,
} from "@/lib/agents/ipl/derive";
import {
  type DiscountClient,
  type DiscountOutcome,
  discountFor,
  discountNote,
  summariseDiscounts,
} from "@/lib/agents/ipl/discount";
import type { IplResult } from "@/lib/agents/ipl/types";

/** A cell is a string OR a number — XLSX keeps numbers numeric; CSV stringifies. */
/** Step 738 — the shared, formula-guarded encoder's value type. */
type Cell = string | number;

/** item index -> the option indices ticked on that line. */
export type IplSelection = ReadonlyMap<number, ReadonlySet<number>>;

/**
 * What one exported price MEANS: its column header, its currency, and — since
 * Step 815 (audit N2) — its per-unit / tier qualifier.
 *
 * `IplPrice.unit` ("per 100 m", "10+") was parsed, stored, and rendered in
 * exactly ONE place in the card, while `export.ts` never referenced it at all.
 * So a price quoted per 100 m, multiplied by a 50 m quantity, landed in a
 * spreadsheet with nothing anywhere saying so — in the artifact that outlives
 * the card and gets forwarded to people who never saw it. It belongs here
 * rather than in a fourth column per price list: this cell already answers
 * "what does this number mean", and the qualifier is part of that answer.
 */
function basisOf(label: string, currency: string, unit = ""): string {
  const head = !label
    ? currency
    : currency && !label.toLowerCase().includes(currency.toLowerCase())
      ? `${label} (${currency})`
      : label;
  return unit ? `${head} · ${unit}`.trim() : head;
}

/** Step 1104 — the five discount cells of one option row. */
function discountCells(outcome: DiscountOutcome, quantity: number): Partial<Record<Header, Cell>> {
  return {
    "Discount group":
      outcome.kind === "applied" || outcome.kind === "group_not_in_matrix" ? outcome.group : "",
    "Discount %": outcome.kind === "applied" ? outcome.percent : "",
    "Net unit price": outcome.net,
    "Net line total": outcome.net * quantity,
    "Discount note": discountNote(outcome),
  };
}

/** Export wording for the three no-match kinds. See `noMatchKind`. */
const NO_MATCH_LABEL: Record<IplNoMatchKind, string> = {
  not_searched: "not searched (search failed — re-run)",
  not_a_product: "not a product",
  not_found: "not found",
};

/**
 * The columns, in order. The FIRST FIVE are the confirm-step sheet's own lead
 * (`lib/pricing/source-export.ts`), verbatim and in its order — Step 1102, the
 * operator's request: "export column in the order similar to 1st stage export:
 * A - Position; B - Item; C - Code; D - Quantity …". A reader reconciling the
 * priced sheet against the one they downloaded a step earlier finds the line's
 * own facts in the same columns on both.
 *
 * ⚠️ `Position` and `Unit` were absent from this sheet altogether. `position` is
 * the row's own number on the tender (Step 818) and is how a reader finds the
 * line in the original; `unit` is what the quantity is a quantity OF ("m",
 * "vnt.", "kompl.") — a `Qty` of 50 means something different per metre and
 * per piece, and until now the priced sheet carried the number without it.
 * Both have been stored on every line since Step 1032's projection kept them
 * "even though nothing reads them"; something does now.
 *
 * ⚠️ FIXED, NOT EMERGING, unlike the confirm sheet. That sheet hides a column
 * no line has a value for; this one has been fixed-column since Step 1086 (one
 * row per option, every column always present) and stays so, because the
 * request was made in COLUMN LETTERS — a layout someone builds a template or a
 * formula against must not shift left on a document that happens to carry no
 * position numbers. A run from before Step 818 simply has an empty column A.
 *
 * ⚠️ `Unit` beside `Unit price` is deliberate and is NOT the Step-815 (N2)
 * regression, which was a column NAMED `unit` that HELD the unit PRICE. Here
 * `Unit` holds the line's own unit, `Unit price` holds the price, and the
 * price's per-unit qualifier ("per 100 m") rides in `Basis` as before — three
 * different things, three columns, each header saying what its cell holds.
 * `eval:ipl-price` pins all three on one row.
 */
const HEADERS = [
  "Position",
  "Item",
  "Code",
  "Qty",
  "Unit",
  "Model",
  "Model code",
  "Brand",
  // ⚠️ Step 1123 — "Match %" is BACK (operator's call), in the column it held
  // before Step 1118: the judge's score, numeric, blank on a line with no
  // match. It is evidence, not a gate — the floor is still gone and every
  // ticked price is still in the total whatever this cell says.
  // ⚠️ Every column after it moved one letter to the RIGHT (Status I→J,
  // Unit price J→K, …), which the operator accepted knowingly.
  "Match %",
  // ⚠️ Step 1118 — the "Confidence" verdict is gone with the confidence floor
  // (a match is a match). "Status" is what is LEFT of that column: a NO-MATCH
  // reason (why a line carries no model) and, on the total row, the line
  // count — neither of which is a confidence signal.
  "Status",
  // Step 815 (N2) — "unit" NAMED a column that held the unit PRICE, while the
  // actual unit qualifier was absent from the sheet entirely. The header says
  // what the cell holds; the qualifier rides in "Basis".
  "Unit price",
  "Basis",
  "Line total",
  "Price list",
  // ⚠️ Step 1153 — the price row's OWN description of the article, the
  // supplier's words (operator: "take the original item name for xls export").
  // `Model` is the name the IDENTITY came from (a datasheet, a catalogue);
  // this is what the PRICE LIST calls it, beside the price list's name. Blank
  // on a run from before this step and on a price whose row had no name cell.
  // APPENDED, so every column letter Steps 1102/1123 fixed stays put on the
  // Match sheet (this is column O, after `Price list` at N); on the Price-step
  // sheet the five discount columns move one letter to the right (P–T), as
  // Step 1123's insert moved everything after it.
  "Price list item",
] as const;
/**
 * Step 1104 — the Price step's columns, APPENDED to the thirteen above (Step
 * 1118 dropped "Match %") when the sheet is downloaded from stage 3 with a
 * client chosen. The stage-2 sheet is
 * byte-identical to what Step 1102 shipped: the operator asked for its layout
 * in column letters, and five empty columns on every Match-step download would
 * have broken that for a stage it is not about.
 */
const DISCOUNT_HEADERS = [
  "Discount group",
  "Discount %",
  "Net unit price",
  "Net line total",
  "Discount note",
] as const;
type Header = (typeof HEADERS)[number] | (typeof DISCOUNT_HEADERS)[number];

/**
 * A row addressed by HEADER rather than by position, so the totals row and the
 * notes cannot drift a column to the left when one is inserted — which is
 * exactly what Step 1102 did, and every positional literal here would have
 * silently put "TOTAL" under Position and the sum under Basis.
 */
function atHeaders(headers: readonly Header[], cells: Partial<Record<Header, Cell>>): Cell[] {
  return headers.map((h) => cells[h] ?? "");
}

/**
 * The Price step's input to the sheet: which client, resolved against the
 * discount table(s) the page found. `client` null = no client chosen yet.
 */
export interface IplExportDiscount {
  client: DiscountClient | null;
  /** The file the client's row came from, for the NOTES block. */
  sourceFile: string;
}

/**
 * The sheet: ONE ROW PER SELECTED OPTION, plus every line that produced none.
 *
 * ⚠️ THE OPERATOR PRINTS THIS TO COMPARE SUPPLIERS (Step 1086): "user will print
 * two possible prices for one item. This also will work if one Item describes
 * two separate parts." So a line with two ticked options is TWO ROWS sharing the
 * line's own cells, and the reader sees both prices side by side. The shape is
 * the same whether those rows are two candidates for one item or two parts of
 * one package — the sheet is a working list whose reader knows which, and the
 * arithmetic (sum what is ticked) is correct either way.
 *
 * ⚠️ A COLUMN-PER-PRICE-LIST WOULD HAVE BEEN WRONG HERE, and that is what this
 * replaces. The old shape gave each price list three columns and each line ONE
 * row, so a line matching two products in the SAME list had nowhere to put the
 * second — `priceFor` silently took the first and a note said "first used". A
 * row per option has room for both, and needs no such note.
 *
 * ⚠️ AN UNPRICED LINE IS STILL A ROW. The card COLLAPSES those (Step 1086); the
 * sheet is where a user finds the real order line whose price we missed, so it
 * keeps every one and says WHICH kind of no-match it was. It is forwarded to a
 * buyer who never saw the run, so "we could not search this line" reaching them
 * as "not found" reads as "unavailable" — a claim about their supplier that we
 * have no evidence for (Step 1033). Same rule as Step 1081, where hiding lines
 * on the card was only acceptable BECAUSE the export still listed them.
 */
export function buildIplTable(
  result: IplResult,
  selected: IplSelection,
  maxOptions: number,
  discount?: IplExportDiscount,
): { headers: string[]; rows: Cell[][] } {
  // ⚠️ The discount columns exist only on the Price step's download — see
  // DISCOUNT_HEADERS. `at` maps every row onto whichever list is in force.
  const cols: readonly Header[] = discount ? [...HEADERS, ...DISCOUNT_HEADERS] : [...HEADERS];
  const at = (cells: Partial<Record<Header, Cell>>) => atHeaders(cols, cells);
  const headers: string[] = [...cols];
  const client = discount?.client ?? null;

  const rows: Cell[][] = [];
  for (const [index, item] of result.items.entries()) {
    // The line's own cells, repeated on each of its option rows so every row
    // stands alone once the sheet is sorted or filtered.
    const lineCells = (): Partial<Record<Header, Cell>> => ({
      Position: item.source.position ?? "",
      Item: item.source.name,
      Code: item.source.code,
      // Blank rather than 1 when the quantity was assumed — the export must not
      // invent a quantity the user's list never stated. The totals row reports
      // how many were assumed for the sum.
      //
      // Step 815 (N1) — keyed to the ASSUMPTION, not to `?? ""`. A line reading
      // `quantity: 0` printed a literal 0 here while the line total beside it
      // was computed at 1 x price: a self-contradiction in the artifact that
      // reaches a customer. Blank-plus-a-note is honest; 0-next-to-a-total is not.
      // (quantityFor, not source.quantity, so the cell prints the quantity the
      // line total was actually computed with — they can no longer disagree.)
      Qty: quantityWasAssumed(item) ? "" : quantityFor(item),
      // Step 1122 — `m'` prints as `m`, the same rule as the stage-1 sheet.
      Unit: displayUnit(item.source.unit),
    });

    const ticked = selected.get(index);
    const chosen = pricedOptionsOf(item, maxOptions).filter((o) => ticked?.has(o.index));

    // Step 1126 — a composite line's parts that matched NOTHING, one row each,
    // after the line's own rows. The half that priced must not read as the
    // whole set: a buyer forwarding this sheet sees "part not found:
    // RWM10.0N1E" under the outdoor unit's price, not a quote for a heat pump
    // that is silently missing its indoor unit. No price on the row, so the
    // totals are untouched.
    const pushPartsNotFound = () => {
      for (const part of item.partsNotFound ?? []) {
        rows.push(at({ ...lineCells(), Status: `part not found: ${part}` }));
      }
    };

    if (chosen.length === 0) {
      // Step 1033 — a line with no ticked price says WHY. A line that DID match
      // a product says "no price selected" instead of borrowing one of the
      // three no-match labels: "not found" about a product we identified would
      // be a claim about the supplier's catalogue that we never made.
      //
      // ⚠️ Step 1118 — a line whose only options the DISPLAY rules hid
      // (`IPL_MIN_OPTION_PERCENT` / the gap) also reads "no price selected"; the
      // old "match too weak to show" wording was the confidence signal, and
      // there is none any more.
      rows.push(
        at({
          ...lineCells(),
          Model: item.match?.name ?? "",
          "Model code": item.match?.code ?? "",
          Brand: item.match?.brand ?? "",
          // Step 1123 — the score of the match this line DID make, if any.
          "Match %": item.match ? item.match.percent : "",
          // A matched line with no CHOSEN option (all its options hidden by the
          // display rules, or none priced) → "no price selected"; a no-match
          // line carries the reason. ⚠️ Step 1118 — the old "match too weak to
          // show" wording is gone: that was the confidence signal, and there is
          // none now. `hiddenOnly` no longer changes the words.
          Status: item.match ? "no price selected" : NO_MATCH_LABEL[noMatchKind(item)],
        }),
      );
      pushPartsNotFound();
      continue;
    }

    for (const o of chosen) {
      const p = o.price;
      rows.push(
        at({
          ...lineCells(),
          Model: o.match.name,
          "Model code": o.match.code,
          Brand: o.match.brand ?? "",
          // Step 1123 — this OPTION's own score (a runner-up carries its own).
          "Match %": o.match.percent,
          // Step 1126 — on a composite line, WHICH PART of the code this row
          // answers, so two rows under one line read as the two halves of a
          // set rather than as two suppliers to choose between.
          ...(o.match.part ? { Status: `part: ${o.match.part}` } : {}),
          "Unit price": p ? p.value : "",
          Basis: p ? basisOf(p.label, p.currency, p.unit) : "",
          "Line total": p ? p.value * quantityFor(item) : "",
          "Price list": p ? p.sourceFile : "",
          // Step 1153 — absent on older runs and on rows with no name cell → "".
          "Price list item": p?.itemName ?? "",
          // Step 1104 — present only on the Price step's sheet (`at` drops
          // cells whose header is not in force). Net figures stay NUMERIC and
          // at full precision; the note says why a row is at list price.
          ...(discount && p ? discountCells(discountFor(p, client), quantityFor(item)) : {}),
        }),
      );
    }
    pushPartsNotFound();
  }

  // ---- totals ----
  // One row PER CURRENCY, never a single mixed sum.
  const sum = summariseSelection(result, selected, maxOptions);
  // Step 1104 — the SAME walk, priced for the client, so the net total sits
  // beside a list total it was derived from rather than a second one.
  const disc = discount ? summariseDiscounts(result, selected, maxOptions, client) : null;
  for (const [i, t] of sum.totals.entries()) {
    const net = disc?.totals.find((d) => d.currency === t.currency);
    rows.push(
      at({
        Item: i === 0 ? "TOTAL" : "",
        // Step 815 (R2) — the REQUESTED line count. `result.items.length` is what
        // the run processed, so a cancelled run labelled its total "8 lines" as
        // though the list had been 8 lines long.
        Status: i === 0 ? `${sum.total} lines` : "",
        Basis: `${t.currency || "unstated"} · ${sum.priced}/${sum.total} priced`,
        "Line total": t.sum,
        ...(net ? { "Net line total": net.net } : {}),
      }),
    );
  }

  // A note row for the assumptions behind those totals — present only when
  // there is something to disclose, so a clean run stays clean.
  const notes: string[] = [];
  // Step 815 (R2) — a PARTIAL run is disclosed FIRST and once: it qualifies
  // every figure in the sheet. Without it a cancelled run exported a total over
  // the lines it happened to reach, with the same coverage framing as a
  // complete one.
  if (result.cancelled || sum.notProcessed > 0) {
    notes.push(
      `INCOMPLETE RUN — ${sum.notProcessed} of ${sum.total} line(s) were never priced${
        result.cancelled ? " (cancelled)" : ""
      }. Every total below covers only the lines that were.`,
    );
  }
  // Step 1086 — a line that contributed TWO prices is correct arithmetic that
  // READS as one item. Disclosed for the same reason `assumedQty` is: a
  // convenient default is fine, an invisible one is not.
  if (sum.multiOptionLines > 0) {
    notes.push(
      `${sum.multiOptionLines} line(s) contributed more than one price, so the total counts them more than once. Untick the options you do not want to narrow it to a single-price quote.`,
    );
  }
  if (sum.assumedQty > 0) notes.push(`${sum.assumedQty} line(s) assumed qty 1`);
  // Step 1118 — no "below the confidence floor" note: every priced option is
  // in the total now.
  if (sum.labels.length > 1) notes.push(`summed from: ${sum.labels.join(", ")}`);
  // Step 1104 — what the net figures are, and what they are NOT. A sheet that
  // showed a net total without naming the client would be a quote nobody could
  // check; one that silently priced 69% of lines at list would be worse.
  if (disc && discount) {
    if (!client) {
      notes.push("DISCOUNTS: no client chosen — every net figure equals the list price.");
    } else {
      const pricedRows = disc.rows.length;
      notes.push(
        `DISCOUNTS: client "${client.name}" from ${discount.sourceFile || "the discount table"} — applied on ${disc.applied} of ${pricedRows} priced row(s).`,
      );
      if (disc.uncovered.size > 0) {
        const groups = [...disc.uncovered.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([g, n]) => `${g} (${n})`)
          .join(", ");
        notes.push(
          `AT LIST PRICE — discount group not in the table for this client: ${groups}. Add these groups to the discount table to price them.`,
        );
      }
      if (disc.noGroup > 0) {
        notes.push(
          `AT LIST PRICE — ${disc.noGroup} row(s) carry no discount group (the price list has none, or the run predates discount groups; re-run Match to pick them up).`,
        );
      }
    }
  }
  if (notes.length > 0) {
    rows.push([]);
    rows.push(at({ Item: "NOTES" }));
    // One note per ROW, in the Item column. Spreading them sideways would land
    // long prose in "Code" and make that column absurdly wide in Excel — the
    // Item column is already sized for text.
    for (const n of notes) rows.push(at({ Item: n }));
  }

  return { headers, rows };
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeBase(base: string | undefined): string {
  const stem = (base ?? "").replace(/\.[^.]+$/, "").trim();
  return stem || "item-price-list";
}

export function downloadIplCsv(
  result: IplResult,
  selected: IplSelection,
  maxOptions: number,
  base?: string,
): void {
  const { headers, rows } = buildIplTable(result, selected, maxOptions);
  const body = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  // Leading BOM (from a char code, not a literal in source) so Excel opens
  // UTF-8 — Lithuanian item names otherwise arrive mojibaked.
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom + body], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, `${safeBase(base)}.csv`);
}

export async function downloadIplXlsx(
  result: IplResult,
  selected: IplSelection,
  maxOptions: number,
  base?: string,
  discount?: IplExportDiscount,
): Promise<void> {
  const { headers, rows } = buildIplTable(result, selected, maxOptions, discount);
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Prices");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  // Step 1104 — the Price step's sheet is a different file from the Match
  // step's, so a folder holding both says which is which.
  triggerDownload(blob, `${safeBase(base)}${discount ? "-pricelist" : ""}.xlsx`);
}
