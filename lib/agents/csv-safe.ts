/**
 * CSV cell encoding for the agent exports — PURE, and deliberately SHARED.
 *
 * MOI and IPL each had their own copy that quoted correctly but had no formula
 * guard. A copied security check is one that drifts (the Step-722 lesson), and
 * this one has to hold for both, so there is exactly one.
 *
 * ## Why the formula guard (Step 738 / IPL audit R6)
 *
 * Excel, LibreOffice and Sheets treat a CSV cell whose text begins with `=`,
 * `+`, `-` or `@` as a FORMULA, not text. `=cmd|'/c calc'!A1` sitting in a
 * product name becomes an execution prompt on the machine that opens the file.
 *
 * The text in these exports is not the user's own writing: item names, codes,
 * COLUMN HEADERS and file names are all read out of uploaded documents —
 * typically a supplier's price list or datasheet, authored by someone else. And
 * the export is the artefact that travels: it gets forwarded to colleagues and
 * customers who never saw the card it came from. So the untrusted-input path and
 * the widest-blast-radius path are the same path.
 *
 * The mitigation is the standard one: prefix the dangerous cell with a single
 * quote, which every spreadsheet reads as "this is text". It is visible in some
 * viewers — a cosmetic cost that is obviously worth paying.
 *
 * ## Why NUMBERS are exempt
 *
 * A negative number stringifies to `-5`, which starts with a guarded character.
 * Quoting it would turn money into text and break the sheet's own arithmetic —
 * and "values stay numeric so the sheet is still summable" is a stated contract
 * of the IPL export. A `number` cannot carry a formula, so the guard applies to
 * STRINGS only, which loses nothing.
 *
 * XLSX needs no guard: `aoa_to_sheet` writes a JS string as a string-typed cell,
 * and a string cell is never evaluated. CSV has no types, which is exactly what
 * makes it the vulnerable format.
 */

/** Characters that make a spreadsheet read the cell as a formula. */
const FORMULA_LEAD = new Set(["=", "+", "-", "@"]);

export type CsvValue = string | number;

/** One CSV cell: formula-guarded (strings only), then RFC-4180 quoted. */
export function csvCell(value: CsvValue): string {
  if (typeof value === "number") return String(value);
  const guarded = needsFormulaGuard(value) ? `'${value}` : value;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * Exported for the eval — the decision, separate from the quoting around it.
 *
 * Leading whitespace is stripped BEFORE the test. TAB and CR appear on the usual
 * published list of dangerous lead characters, but the reason they do is that
 * they let a formula slip past a check that only looks at index 0 — a tab then
 * `=cmd|…` is still a formula once the parser trims. Stripping first covers that
 * without the contradiction of treating a bare leading tab, which no spreadsheet
 * evaluates, as an attack.
 *
 * `\s` alone is enough — in JS it already covers U+00A0 and U+202F — so this
 * source carries no invisible characters for an editor or a paste to drop.
 */
export function needsFormulaGuard(value: string): boolean {
  const lead = value.replace(/^\s+/u, "")[0];
  return lead !== undefined && FORMULA_LEAD.has(lead);
}
