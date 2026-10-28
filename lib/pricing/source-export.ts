/**
 * The CONFIRM-STEP export (Step 1064) — the lines read out of the uploaded
 * document, as a spreadsheet, before anything is priced.
 *
 * ⚠️ FOUR POPULATED FIELDS WERE CAPTURED AND SHOWN NOWHERE. Measured on the
 * operator's real 15-line tender: `position` 15/15, `unit` 15/15, `kind` 15/15
 * and `specs` 9/15 are all extracted and stored, and the card renders only the
 * name, code and quantity. This is where they become useful — their absence is
 * why "export the first step" is worth more than a screenshot of it.
 *
 * ⚠️ THE EXPORT CARRIES THE GUARDS, the same rule the priced export states:
 * a spreadsheet outlives the card and gets forwarded to people who never saw
 * it, so a file that drops the qualifiers is strictly MORE dangerous than the
 * UI it came from. Every coverage fact the confirm card shows — the "of N", the
 * cap, the byte cut, the numbered rows the document declares and the read did
 * not return, the shortfall, and an early stop — is carried into a NOTES block.
 * ⚠️ Read through `readPricingCoverage`'s OUTPUT rather than re-derived, so the
 * card and the file cannot come to describe one gather in two vocabularies.
 *
 * ⚠️ COLUMNS EMERGE. A column is present only when some line has a value for
 * it, exactly as the priced export lets price columns emerge from the data: a
 * document with no specification references should not hand its reader three
 * empty columns to scroll past.
 *
 * Values stay NUMERIC where they are numbers (quantity), so the sheet is
 * sortable and summable.
 *
 * ⚠️ Step 1121 — TWO SHEETS IN ONE FILE, and fixed column widths. Operator's
 * ask: "export to xls but in several sheets: total — all the list of items;
 * excQty — list of items excluding items with no Qty", with a width per column
 * letter. `total` is the sheet this module has always produced (every line
 * READ, the recourse Step 1081 made it); `excQty` is the same columns over the
 * lines that carry a quantity. A third sheet the operator first named,
 * `excPriceQty`, was DROPPED by operator decision after the finding that no
 * line carries a price at this stage — see `buildSourceSheets`.
 */

import { displayUnit, hasStatedQuantity } from "@/lib/agents/ipl/derive";
import type { MoiSourceItem } from "@/lib/agents/moi/types";
import type { PricingCoverage } from "@/lib/pricing/confirm";

/** A cell is a string OR a number — XLSX keeps numbers numeric. */
type Cell = string | number;

interface Column {
  header: string;
  /** Empty string means "this line has no value", which is what hides a column. */
  value: (it: MoiSourceItem) => Cell;
}

/**
 * ⚠️ ORDER IS THE DOCUMENT'S, then identity, then detail. `position` leads
 * because on a tender it is the row's own number (Step 818) and the reader is
 * usually reconciling against the original.
 */
const COLUMNS: Column[] = [
  { header: "Position", value: (it) => it.position ?? "" },
  { header: "Item", value: (it) => it.name ?? "" },
  { header: "Code", value: (it) => it.code ?? "" },
  // ⚠️ Numeric, not "3 vnt." — the unit is its own column precisely so the
  // quantity stays a number the sheet can add up.
  { header: "Qty", value: (it) => (typeof it.quantity === "number" ? it.quantity : "") },
  // Step 1122 — `m'` prints as `m` (see `displayUnit`); the stored unit stays
  // verbatim.
  { header: "Unit", value: (it) => displayUnit(it.unit) },
  { header: "Kind", value: (it) => it.kind ?? "" },
  { header: "Specification", value: (it) => it.specs ?? "" },
  // The reference and its distilled attributes (Step 820). Absent on a document
  // whose specifications are inline, which is why these emerge rather than
  // always appearing.
  { header: "Spec ref", value: (it) => it.ref ?? "" },
  { header: "Ref specification", value: (it) => it.refSpecs ?? "" },
];

function hasValue(c: Cell): boolean {
  return typeof c === "number" ? true : c.trim().length > 0;
}

/**
 * Step 1121 — the operator's column widths, in PIXELS, as given: "A - 96px,
 * B - 520, C - 240px, D - 70px, E - 100px, F - 120px, G - 500px, H - 180px,
 * I - 2000px, J - 70px".
 *
 * ⚠️ KEYED BY HEADER, NOT BY LETTER. The ask was in letters, and A–J is exactly
 * the nine columns above plus `Priced`, in this order — on the operator's own
 * documents every one of them emerges, so the letters and the headers agree.
 * But this sheet's columns EMERGE (a document with no spec references drops
 * three), and a width stored against a letter would then land on the wrong
 * column: 2000px on "Priced" and 70px on "Ref specification". Stored against
 * the header, a column keeps its width wherever it lands. (The priced sheet
 * solved the same request the other way — it went fixed-column; this one stays
 * emerging because Step 1081 made "every line, no empty scroll" its point.)
 */
const COLUMN_WIDTH_PX: Readonly<Record<string, number>> = {
  Position: 96,
  Item: 520,
  Code: 240,
  Qty: 70,
  Unit: 100,
  Kind: 120,
  Specification: 500,
  "Spec ref": 180,
  "Ref specification": 2000,
  Priced: 70,
};

/**
 * Excel's column width is capped at 255 CHARACTERS (a documented spec limit);
 * SheetJS turns `wpx` into characters at ~7px each plus 5px of padding, so
 * 255 chars is 1790px. The operator asked for 2000px on "Ref specification",
 * which converts to ~285 characters — above the cap, and a file that says so is
 * one Excel may offer to "repair". Clamped here rather than at the map, so the
 * map still records what was asked for.
 */
const EXCEL_MAX_COLUMN_PX = 255 * 7 + 5;

/**
 * The `!cols` entry per header, for SheetJS. A header with no width recorded
 * (there is none today) gets an empty entry, i.e. the spreadsheet's default —
 * never a guess.
 */
export function columnWidths(headers: readonly string[]): { wpx?: number }[] {
  return headers.map((h) => {
    const px = COLUMN_WIDTH_PX[h];
    return px === undefined ? {} : { wpx: Math.min(px, EXCEL_MAX_COLUMN_PX) };
  });
}

/**
 * One read line with its ORIGINAL index. `Priced` reads the selection by that
 * index, so a sheet that lists only some lines must not renumber them — a
 * filtered `excQty` built from `items.map((it, i) => …)` would look up the
 * fourth kept line's tick under index 3, which is some other line's.
 */
interface Line {
  item: MoiSourceItem;
  index: number;
}

/**
 * The columns that have a value on SOME line. Computed once over the FULL list
 * and shared by every sheet in the file (Step 1121): if `excQty` chose its own
 * from the lines it keeps, the two sheets could carry different columns and
 * the same header could sit in a different letter on each.
 */
function liveColumns(items: MoiSourceItem[]): Column[] {
  return COLUMNS.filter((c) => items.some((it) => hasValue(c.value(it))));
}

/** Header row, one row per line, then a NOTES block — the shape of every sheet. */
function tableFor(
  lines: Line[],
  live: Column[],
  narrowed: boolean,
  selected: Set<number> | undefined,
  notes: string[],
): { headers: string[]; rows: Cell[][] } {
  const headers = [...live.map((c) => c.header), ...(narrowed ? ["Priced"] : [])];
  const rows: Cell[][] = lines.map(({ item, index }) => [
    ...live.map((c) => c.value(item)),
    ...(narrowed ? [selected?.has(index) ? "yes" : "no"] : []),
  ]);
  if (notes.length > 0) {
    rows.push([]);
    rows.push(["", "NOTES"]);
    // One note per ROW, in the Item column — spreading them sideways would land
    // long prose in "Code" and make that column absurdly wide in Excel.
    for (const n of notes) rows.push(["", n]);
  }
  return { headers, rows };
}

/**
 * Every note the confirm card would show, in the card's own words.
 *
 * ⚠️ NOT a re-derivation. `readPricingCoverage` is the ONE reader of the stored
 * coverage fields (Step 1033, three consumers); this takes its OUTPUT so the
 * file and the card cannot disagree about what the gather covered.
 */
export function coverageNotes(
  read: number,
  coverage: PricingCoverage,
  capped: boolean,
  itemsSizeCut: number,
): string[] {
  const notes: string[] = [];
  notes.push(
    coverage.totalCount > read
      ? `Read ${read} of ${coverage.totalCount} lines found in the document.`
      : `Read ${read} ${read === 1 ? "line" : "lines"}.`,
  );
  // ⚠️ This one renders even when every other clause is silent: on a stopped
  // run "Read 40 of 40" is true of what was read and false about the file.
  if (coverage.stoppedEarly) {
    notes.push(
      `INCOMPLETE — reading stopped at a time limit after ${coverage.stoppedEarly.read} of ` +
        `${coverage.stoppedEarly.total} ${coverage.stoppedEarly.unit}(s), so the rest of the ` +
        `file was not read. Split the file into smaller uploads to cover it.`,
    );
  }
  if (capped) notes.push("The file held more lines than one run reads; this is the first batch.");
  // ⚠️ A byte cut is NOT `capped` — that means the FILE held more, this means
  // the lines we read do not fit (Step 1051). Same consequence, different cause.
  if (itemsSizeCut > 0) {
    notes.push(`${itemsSizeCut} line(s) were dropped to fit the stored run.`);
  }
  if (coverage.missingPositions.length > 0) {
    notes.push(
      `Your document numbers these rows and the read did not return them: ` +
        `${coverage.missingPositions.join(", ")}. They may be absent from the file, or missed ` +
        `while reading it.`,
    );
  }
  if (coverage.shortfall && coverage.shortfall.expected !== coverage.totalCount) {
    notes.push(
      `Your document looks like it has about ${coverage.shortfall.expected} buyable rows, so ` +
        `${coverage.shortfall.missing} may be missing.`,
    );
  }
  return notes;
}

/**
 * The sheet: header row, one row per line, then a NOTES block.
 *
 * `selected` narrows nothing — every line READ is exported. It only adds a
 * "Priced" column, and only when the user has actually narrowed the run:
 * ⚠️ dropping the unticked lines would silently delete rows the reader can see
 * in their own document, which is the opposite of what this file is for.
 */
export function buildSourceTable(
  items: MoiSourceItem[],
  coverage: PricingCoverage,
  capped: boolean,
  itemsSizeCut: number,
  selected?: Set<number>,
): { headers: string[]; rows: Cell[][] } {
  // Step 1121 — the `total` sheet, verbatim: what this function has returned
  // since Step 1064, now built by the helper both sheets share. Destructured
  // so the tab `name` does not ride along — callers (the eval) compare this
  // shape whole, and a key that was never there is a difference.
  const { headers, rows } = buildSourceSheets(items, coverage, capped, itemsSizeCut, selected)[0];
  return { headers, rows };
}

/** One sheet of the confirm-step file: its tab name and its table. */
export interface SourceSheet {
  name: string;
  headers: string[];
  rows: Cell[][];
}

/**
 * Step 1121 — the file's sheets, in tab order:
 *
 *   total   every line READ (the Step-1064 sheet, unchanged)
 *   excQty  the lines that carry a quantity
 *
 * ⚠️ "HAS A QUANTITY" IS THE CONFIRM STEP'S OWN RULE, `hasStatedQuantity` —
 * a finite number GREATER THAN ZERO — and not a third copy of the test. The
 * card pre-unticks a line by exactly this predicate (`carriesNothingToPrice`,
 * Step 1080) and hides it (Step 1081), so a line with `quantity: 0` leaves
 * `excQty` for the same reason it left the card. Two definitions of this once
 * existed and disagreed (the Step-815 record on `quantityWasAssumed`); a sheet
 * that kept a zero-quantity line the card had hidden would be the third.
 *
 * ⚠️ `excQty` IS NOT "the ticked lines". The two coincide on a fresh run —
 * pre-unticking is BY quantity — and diverge the moment the user ticks or
 * unticks a line by hand. The operator asked for the quantity, so that is the
 * filter; `Priced` still says what was ticked, on both sheets, and reads each
 * line's tick by its ORIGINAL index (see `Line`).
 *
 * ⚠️ THE GUARDS TRAVEL ONTO BOTH SHEETS. A tab gets copied out of a workbook
 * and forwarded on its own, so `excQty` carries every coverage note `total`
 * does — "Read N of M", the cap, the byte cut, the missing positions — plus,
 * FIRST, what it leaves out and where those lines are: it qualifies every row
 * below it, the Step-815/R2 placement.
 *
 * ⚠️ NO `excPriceQty`. The operator's first ask named a third sheet excluding
 * lines with no quantity AND no price. Nothing at this stage HAS a price —
 * `MoiSourceItem` carries position / name / code / quantity / unit / kind /
 * specs and a reference; prices exist only after the Match step — so that
 * sheet could only ever equal this one. Dropped by operator decision
 * (2026-09-16) rather than shipped as a duplicate tab with a misleading name.
 */
export function buildSourceSheets(
  items: MoiSourceItem[],
  coverage: PricingCoverage,
  capped: boolean,
  itemsSizeCut: number,
  selected?: Set<number>,
): [total: SourceSheet, excQty: SourceSheet] {
  const live = liveColumns(items);
  const narrowed = selected !== undefined && selected.size < items.length;

  const all: Line[] = items.map((item, index) => ({ item, index }));
  const withQty = all.filter((l) => hasStatedQuantity(l.item));

  const base = coverageNotes(items.length, coverage, capped, itemsSizeCut);
  const narrowedNote = narrowed
    ? [
        `${selected?.size ?? 0} of ${items.length} lines are selected for pricing; the rest are ` +
          `listed here but will not be priced.`,
      ]
    : [];

  const total = tableFor(all, live, narrowed, selected, [...base, ...narrowedNote]);

  const left = all.length - withQty.length;
  const excQty = tableFor(withQty, live, narrowed, selected, [
    `This sheet lists the ${withQty.length} of ${all.length} lines that carry a quantity; ` +
      `${left} line(s) with none are on the "total" sheet only.`,
    ...base,
    ...narrowedNote,
  ]);

  return [
    { name: "total", ...total },
    { name: "excQty", ...excQty },
  ];
}

/**
 * Step 1121 — the workbook: one tab per sheet, in `buildSourceSheets`' order
 * (`total` first, so the file opens on the complete list), each with the
 * operator's column widths. `!cols` is set PER SHEET — SheetJS keeps it on the
 * worksheet, and a width set on one tab says nothing about the next.
 *
 * ⚠️ TAKES THE SHEETJS MODULE RATHER THAN IMPORTING IT, for two reasons. The
 * download's dynamic `import("xlsx")` stays the only one, so SheetJS stays out
 * of the bundle until asked for. And `_probe-1121.ts` executes THIS loop: the
 * first draft of that probe rebuilt the loop by hand, and `break-step-1121`
 * showed a mutation that set `!cols` on one tab only sailing through — the
 * probe's own copy was still correct. A test that duplicates the code it tests
 * verifies the duplicate.
 */
export function buildSourceWorkbook(
  sheets: readonly SourceSheet[],
  XLSX: typeof import("xlsx"),
): import("xlsx").WorkBook {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([s.headers, ...s.rows]);
    ws["!cols"] = columnWidths(s.headers);
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  return wb;
}

function safeBase(base: string | undefined): string {
  const stem = (base ?? "").replace(/\.[^.]+$/, "").trim();
  return stem || "pricing-lines";
}

export async function downloadSourceXlsx(
  items: MoiSourceItem[],
  coverage: PricingCoverage,
  capped: boolean,
  itemsSizeCut: number,
  selected: Set<number> | undefined,
  base?: string,
): Promise<void> {
  const sheets = buildSourceSheets(items, coverage, capped, itemsSizeCut, selected);
  // Dynamic-imported so SheetJS stays out of the bundle until asked for — the
  // same reason the priced export defers it.
  const XLSX = await import("xlsx");
  const wb = buildSourceWorkbook(sheets, XLSX);
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  // ⚠️ NO formula guard, and that is a property of XLSX rather than an omission:
  // a string-typed cell is never evaluated. The moment a CSV twin is added it
  // needs `csvCell` from `lib/agents/csv-safe.ts` — item names and codes are
  // read out of a supplier's document, and a cell starting `=` is a formula.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeBase(base)}-lines.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
