/**
 * The PRICING document (Step 1110) — the PURE content that goes into a
 * template, whatever the template's kind.
 *
 * ⚠️ ONE BUILDER, TWO RENDERERS. The PDF and the Word export must say the
 * same thing, so what they say is decided ONCE here — from the SAME walk the
 * Price step renders (`summariseDiscounts`, the Step-1104 rule), over the
 * SAME ticks, for the SAME client — and the renderers only decide where the
 * ink goes. A renderer that computed its own rows is how the two exports
 * would come to disagree with the screen.
 *
 * ⚠️ IT CARRIES THE GUARDS THE SCREEN CARRIES: every row at list price says
 * why, the totals name the coverage, and assumed quantities are stated. A
 * document outlives the screen and is forwarded to people who never saw it,
 * so a page that drops the qualifiers is MORE dangerous than the UI.
 * ⚠️ Step 1118 — the confidence floor is gone, so there is no "below floor"
 * row note or total note here any more; every priced row is in the figures.
 *
 * Text only — every cell is a string already formatted for a reader (money at
 * two decimals, the Step-1101 rule), so a renderer never formats a number and
 * the two cannot round differently.
 */

import {
  displayUnit,
  formatMoney,
  quantityWasAssumed,
  summariseSelection,
} from "@/lib/agents/ipl/derive";
import type { DiscountClient } from "@/lib/agents/ipl/discount";
import { discountNote, summariseDiscounts } from "@/lib/agents/ipl/discount";
import { IPL_MAX_MATCHES, type IplResult } from "@/lib/agents/ipl/types";

export const PRICING_DOCUMENT_COLUMNS = [
  "Pos.",
  "Item",
  "Model",
  "Qty",
  "Unit price",
  // "Disc.", not "Discount": one word wider than the PDF's 8% column breaks mid-word.
  "Disc.",
  "Net price",
  "Line total",
] as const;

export interface PricingDocumentRow {
  cells: string[];
  /** Printed under the row in a smaller face — why it is at list price. */
  note: string;
}

export interface PricingDocument {
  title: string;
  /** "Source: file · Date · Discounts for: X" — one per line under the title. */
  meta: string[];
  columns: readonly string[];
  rows: PricingDocumentRow[];
  /** "Total (EUR): 38 149,05 → 21 038,31" — one per currency. */
  totals: string[];
  /** The coverage line and every guard, in reading order. */
  notes: string[];
}

export interface PricingDocumentInput {
  result: IplResult;
  selected: ReadonlyMap<number, ReadonlySet<number>>;
  client: DiscountClient | null;
  /** The discount table's file, for the note that names it. */
  sourceFile: string;
  /** The pricing's own title / source filename, for the header. */
  title: string;
  sourceFilename: string;
  /** Injected so the eval is deterministic. */
  date: Date;
}

/**
 * The locale the export's figures are written in — Step 1114.
 *
 * ⚠️ THE RESULT'S LANGUAGE, NEVER THE PROCESS'S. `formatMoney(v)` on the page
 * follows the browser, which is the reader; the same call on the SERVER follows
 * Node's ICU default, which is whatever machine happens to render — lt-LT on the
 * operator's Windows, en-US on Vercel. So the production export printed
 * `6,283.47` for a customer whose screen read `6 283,47`, and a decimal point in
 * a Lithuanian document is not cosmetic. `result.lang` is the runner's language,
 * stored on every result since IPL shipped; a tag ICU does not know falls back
 * to `en` — a FIXED fallback, because the point is that two renders of one
 * document must agree wherever they run.
 */
export function documentLocale(lang: string | undefined): string {
  const tag = (lang ?? "").trim();
  if (!tag) return "en";
  try {
    return Intl.NumberFormat.supportedLocalesOf([tag]).length > 0 ? tag : "en";
  } catch {
    return "en";
  }
}

export function buildPricingDocument(input: PricingDocumentInput): PricingDocument {
  const { result, selected, client } = input;
  const summary = summariseDiscounts(result, selected, IPL_MAX_MATCHES, client);
  /**
   * Step 1114 (audit H1) — the SELECTION's guards, the same walk the sheet and
   * the Price step's total run. The document carried two of the five and this
   * file's own header promised all of them: a line counted MORE THAN ONCE (the
   * default state — Step 1086 ticks every priced option), an INCOMPLETE or
   * cancelled run, and a MIXED basis were printed on the screen and in the XLS
   * and on nothing that leaves the building. Measured: a two-option line at
   * quantity 1 exported a total of both tanks with no note at all.
   */
  const guards = summariseSelection(result, selected, IPL_MAX_MATCHES);
  const locale = documentLocale(result.lang);

  // ⚠️ ONE currency puts its code in the column HEADER and leaves the cells to
  // the figures — "6 283,47 EUR" in a narrow money column wraps onto two lines.
  // Mixed currencies keep the code on every cell, where it is the difference.
  const currencies = new Set(summary.rows.map((r) => r.price.currency));
  const single = currencies.size === 1 ? [...currencies][0] : null;
  const money = (v: number, currency: string) =>
    single !== null
      ? formatMoney(v, locale)
      : `${formatMoney(v, locale)}${currency ? ` ${currency}` : ""}`;
  const columns = PRICING_DOCUMENT_COLUMNS.map((c, i) =>
    single && (i === 4 || i === 6 || i === 7) ? `${c} (${single})` : c,
  );

  const rows: PricingDocumentRow[] = [];
  let assumed = 0;
  for (const r of summary.rows) {
    const qtyAssumed = quantityWasAssumed(r.item);
    if (qtyAssumed) assumed += 1;
    // Step 1122 — `m'` prints as `m`, the same rule as both spreadsheets.
    const unit = displayUnit(r.item.source.unit);
    const qty = qtyAssumed ? "1*" : `${r.quantity}${unit ? ` ${unit}` : ""}`;
    const model = [r.match.code || r.match.name, r.match.brand].filter(Boolean).join(" · ");
    const o = r.outcome;
    const notes: string[] = [];
    const why = client ? discountNote(o) : "";
    if (why) notes.push(why);
    rows.push({
      cells: [
        r.item.source.position ?? "",
        r.item.source.name,
        model,
        qty,
        money(r.price.value, r.price.currency),
        o.kind === "applied" ? `−${o.percent}%` : client ? "—" : "",
        o.kind === "applied"
          ? money(o.net, r.price.currency)
          : money(r.price.value, r.price.currency),
        money(r.lineNet, r.price.currency),
      ],
      note: notes.join(" · "),
    });
  }

  const totals = summary.totals.map((t) =>
    client && t.net !== t.list
      ? `Total (${t.currency || "—"}): ${formatMoney(t.list, locale)} list → ${formatMoney(t.net, locale)} net`
      : `Total (${t.currency || "—"}): ${formatMoney(t.net, locale)}`,
  );

  const pricedRows = summary.rows.length;
  const notes: string[] = [];
  // ⚠️ FIRST, before the discount lines: a reader who stops after one note
  // must have read that the totals do not cover the whole list. The sheet
  // leads with it for the same reason (Step 815 / R2).
  if (result.cancelled || guards.notProcessed > 0) {
    notes.push(
      `INCOMPLETE RUN — ${guards.notProcessed} of ${guards.total} line(s) were never priced${
        result.cancelled ? " (cancelled)" : ""
      }. Every total covers only the lines that were.`,
    );
  }
  if (client) {
    notes.push(
      `Discounts for ${client.name}${input.sourceFile ? ` (from ${input.sourceFile})` : ""} — applied on ${summary.applied} of ${pricedRows} priced rows.`,
    );
    if (summary.uncovered.size > 0)
      notes.push(
        `At list price — discount group not in the table: ${[...summary.uncovered.keys()].join(", ")}.`,
      );
    if (summary.noGroup > 0)
      notes.push(`${summary.noGroup} row(s) carry no discount group — at list price.`);
  } else {
    notes.push(`List prices — no discount applied. ${pricedRows} priced rows.`);
  }
  // Step 1114 — the two guards the sheet prints and the document did not.
  if (guards.multiOptionLines > 0)
    notes.push(
      `${guards.multiOptionLines} line(s) contributed more than one price, so the total counts them more than once.`,
    );
  if (guards.labels.length > 1) notes.push(`Summed from: ${guards.labels.join(", ")}.`);
  if (assumed > 0) notes.push(`* quantity not stated in the source — counted as 1.`);
  const unpriced = result.items.filter((_, i) => !selected.get(i)?.size).length;
  if (unpriced > 0) notes.push(`${unpriced} line(s) of the source are not in this document.`);

  const meta = [
    `Source: ${input.sourceFilename || input.title}`,
    `Date: ${input.date.toISOString().slice(0, 10)}`,
  ];
  if (client) meta.push(`Discounts for: ${client.name}`);

  return {
    title: input.title || "Pricing",
    meta,
    columns,
    rows,
    totals,
    notes,
  };
}
