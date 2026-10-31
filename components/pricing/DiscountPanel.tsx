"use client";

/**
 * STAGE 3 — Price (Step 1104). The ticked options from the Match step, priced
 * for ONE CLIENT against the discount table found in the user's catalogues.
 *
 * Three things on the panel, in reading order:
 *
 *   1. WHO — a READ-ONLY line naming the beneficiary the prices are discounted
 *      for. ⚠️ Step 1109 (operator's call): the picker that stood here is
 *      GONE. The beneficiary is entered ONCE, at the foot of the Match step
 *      (Steps 1105-1108), and changing it means going back there; this stage
 *      shows the result of that choice and never takes a second one. The
 *      stored name is still resolved against the table every render, so a
 *      name the table lost reads as list prices, said. ⚠️ The table is FOUND,
 *      not uploaded: any accessible file whose rows are keyed by
 *      discount-group codes — or, since Step 1143, whose rows each carry one
 *      group code beside a percent per client tier — qualifies (`isMatrixRow`),
 *      which is the same "columns emerge" rule that makes a document a price
 *      list.
 *   2. THE LINES — one row per ticked option: list price, group, percent, net,
 *      line total, and a NOTE on every row the table does not cover. Never a
 *      silent list price (Step 1103 measured 31% coverage — that is the
 *      common case).
 *   3. THE TOTAL — list beside net, per currency, with the coverage count.
 *
 * ⚠️ EVERYTHING HERE IS VIEW-TIME. Changing the client re-derives every figure
 * from the run's stored prices and the table; nothing is re-matched and no
 * token is spent. The chosen client is stored on the pricing (`discount_client`)
 * so the sheet and a reload agree, but the NUMBERS are never stored — a table
 * the operator extends tomorrow re-prices this page tomorrow.
 *
 * ⚠️ THE TABLE ARRIVES AS A PROP (Step 1105). It used to load when this step
 * opened — ~100 small reads, for a step most visits never reached. The Match
 * step now asks "who is the discount for?" at the foot of its list, so the
 * table is loaded ONCE for the page by `useDiscountTables`, gated on the run
 * carrying groups at all, and both stages read the same load.
 *
 * ⚠️ AND IT IS NOT THE TABLE ANY MORE (Step 1117, audit L6): the load carries
 * every client's NAME and the stored client's ROW, resolved on the server by
 * the same `matchClient` the export route runs. This panel prices on that row;
 * it resolves nothing itself, and the other clients' percentages never reach
 * the browser.
 */
import { AlertTriangleIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useMemo } from "react";
import { OptionItemName, PositionCell } from "@/components/pricing/pricing-parts";
import type { DiscountTables } from "@/components/pricing/use-discount-tables";
import { iconButtonClass } from "@/components/ui/icon-button";
import { formatMoney, summariseSelection } from "@/lib/agents/ipl/derive";
import {
  type DiscountClient,
  type DiscountedRow,
  discountNote,
  summariseDiscounts,
} from "@/lib/agents/ipl/discount";
import { IPL_MAX_MATCHES, type IplResult } from "@/lib/agents/ipl/types";
import { formatQuantity } from "@/lib/pricing/confirm";
import { documentLocale } from "@/lib/pricing/document";
import { cn } from "@/lib/utils";

export function DiscountPanel({
  result,
  selected,
  discountClient,
  tables,
  onReload,
  footer,
  className,
}: {
  result: IplResult;
  /** The Match step's ticks — the SAME map, so the two stages price the same options. */
  selected: ReadonlyMap<number, ReadonlySet<number>>;
  /** The stored choice, verbatim as the table spells it; null = list prices. */
  discountClient: string | null;
  /** The page's one load of the discount table (`useDiscountTables`). */
  tables: DiscountTables;
  /** The "look again" button — after adding groups or clients to the table. */
  onReload: () => void;
  /**
   * Step 1110 — rendered after the total, inside the card: PRICING puts the
   * "Template" export menu here. ⚠️ The XLS button that stood here moved OUT
   * to the Source row under the card (operator's call — "like we use in all
   * other places"), where the Match step's has been since Step 1094.
   */
  footer?: React.ReactNode;
  className?: string;
}) {
  // ⚠️ The stored name, resolved against the table ON THE SERVER for this load
  // (the Step-1104 rule — never an object cached from an earlier one — moved
  // there by L6): a name the table no longer knows arrives as `client: null`
  // and reads as "no discount", not as yesterday's percents.
  // ⚠️ `discountClient` is the page's LIFTED value (Step 1105) — the store,
  // echoed the moment it lands, set by the Match step's ask the instant its
  // write resolves. This panel never writes it (Step 1109).
  const client: DiscountClient | null =
    discountClient && tables.kind === "loaded" ? tables.client : null;
  // Step 1149 — the result's locale, the same one the Match card and the
  // export print in (see `formatMoney`): server-rendered figures must not ask
  // the rendering machine how to spell a number.
  const locale = documentLocale(result.lang);

  const summary = useMemo(
    () => summariseDiscounts(result, selected, IPL_MAX_MATCHES, client),
    [result, selected, client],
  );
  /**
   * Step 1106 — the Match step's Total row is gone (operator's call), so the
   * three guards it carried — a MIXED basis, lines counted MORE THAN ONCE, and
   * ASSUMED quantities — now print under this total, which is the only one a
   * priced run shows on screen. The sheet has carried them all along; a guard
   * the card drops while the export keeps it is the Step-734 rule inverted.
   */
  const guards = useMemo(
    () => summariseSelection(result, selected, IPL_MAX_MATCHES),
    [result, selected],
  );

  // Step 1118 — every priced row counts (no confidence floor).
  const pricedRows = summary.rows.length;
  const uncoveredRows = [...summary.uncovered.values()].reduce((s, n) => s + n, 0);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* ── 1. WHO — only when something is WRONG (Step 1112) ─────────────
          The "Discounts for X · From Nuolaidos.xlsx · N groups" header is gone
          (operator's call): the beneficiary was entered one stage back and the
          total below names the coverage. What stays is every state a reader
          must not miss — the table still loading, failed, or a stored name it
          no longer knows — each with the reload beside it.
          ⚠️ The "no discount table found" state is NOT shown here: the Match
          step's ask already carries it (`DiscountPrompt`, `known.length === 0`),
          where the discount is chosen — repeating it one stage later was the
          same notice twice. */}
      {tables.kind === "loading" ? (
        <span className="inline-flex items-center gap-2 text-subhead text-muted-foreground">
          <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Looking for a discount table in your catalogues…
        </span>
      ) : tables.kind === "error" ? (
        <span className="flex items-center gap-2 text-subhead">
          <span className="text-destructive">{tables.message}</span>
          <ReloadButton onClick={onReload} />
        </span>
      ) : discountClient && !client ? (
        // The stored name no longer resolves — the table changed under it.
        <span className="flex items-center gap-2 text-footnote text-warn">
          <span>
            &ldquo;{discountClient}&rdquo; is not in the discount table any more — prices below are
            list prices.
          </span>
          <ReloadButton onClick={onReload} />
        </span>
      ) : null}

      {/* ── 2. THE LINES ────────────────────────────────────────────────── */}
      {summary.rows.length === 0 ? (
        <p className="text-subhead text-muted-foreground">
          Nothing is ticked on the Match step, so there is nothing to price.
        </p>
      ) : (
        <ul className="flex flex-col [&>li+li]:border-t [&>li+li]:border-hairline">
          {summary.rows.map((r) => (
            <DiscountLine
              key={`${r.itemIndex}:${r.optionIndex}`}
              row={r}
              withClient={client !== null}
              locale={locale}
            />
          ))}
        </ul>
      )}

      {/* ── 3. THE TOTAL ────────────────────────────────────────────────── */}
      {summary.rows.length > 0 ? (
        <div className="flex items-start justify-between gap-3 border-hairline border-t pt-2 text-subhead">
          <span className="text-muted-foreground">Total</span>
          <span className="flex flex-col items-end gap-0.5">
            {summary.totals.map((t) => (
              <span key={t.currency || "?"} className="flex items-baseline gap-3 tabular-nums">
                {client ? (
                  <span className="text-muted-foreground line-through decoration-muted-foreground/60">
                    {formatMoney(t.list, locale)} {t.currency}
                  </span>
                ) : null}
                <span className="font-semibold">
                  {formatMoney(t.net, locale)} {t.currency}
                </span>
              </span>
            ))}
            <span className="text-footnote text-muted-foreground">
              {client ? (
                <>
                  discount on {summary.applied}/{pricedRows} rows
                  {uncoveredRows > 0 ? (
                    <span
                      className="text-warn"
                      title={`Groups not in the table for this client: ${[...summary.uncovered.keys()].join(", ")}. Add them to the discount table to price these rows.`}
                    >
                      {" "}
                      &middot; {uncoveredRows} at list price
                    </span>
                  ) : null}
                  {summary.noGroup > 0 ? (
                    <span title="These prices carry no discount group — the price list has none, or the run predates discount groups.">
                      {" "}
                      &middot; {summary.noGroup} without a group
                    </span>
                  ) : null}
                </>
              ) : (
                <>list prices · {pricedRows} rows</>
              )}
              {guards.labels.length > 1 ? (
                <span
                  className="text-warn"
                  title={`This figure mixes columns that mean different things: ${guards.labels.join(", ")}.`}
                >
                  {" "}
                  &middot; mixed basis
                </span>
              ) : null}
              {guards.multiOptionLines > 0 ? (
                <span title="These lines contributed more than one price, so the figure counts them more than once. Untick the options you do not want to narrow it to a single-price quote.">
                  {" "}
                  &middot; {guards.multiOptionLines}{" "}
                  {guards.multiOptionLines === 1 ? "line counts" : "lines count"} more than once
                </span>
              ) : null}
              {guards.assumedQty > 0 ? (
                <span> &middot; {guards.assumedQty} qty assumed</span>
              ) : null}
              {/* Step 1118 — no "below floor" clause: every priced row is in the total. */}
            </span>
          </span>
        </div>
      ) : null}

      {/* ── the way out: the Template menu (Step 1110) ──────────────────── */}
      {summary.rows.length > 0 && footer ? (
        <div className="flex items-center justify-end border-hairline border-t pt-2">{footer}</div>
      ) : null}
    </div>
  );
}

/**
 * One priced row. The Match step's row geometry (position column, name, then
 * the option's fields hanging under the name), with the discount fields where
 * the checkbox was: this is the same line one stage later, read-only.
 */
function DiscountLine({
  row,
  withClient,
  locale,
}: {
  row: DiscountedRow;
  withClient: boolean;
  /** The result's locale (Step 1149) — the panel derives it once. */
  locale: string;
}) {
  const qtyLabel = formatQuantity(row.item.source);
  const o = row.outcome;
  // Step 1112 — the reason a row is at list price is a WARNING SIGN (the text
  // is its tooltip), not a second line of amber prose. Step 1113 — it LEADS
  // the candidate line, in the indent that line already had.
  const note = withClient ? discountNote(o) : "";
  return (
    <li className="flex items-start gap-2.5 px-1 py-2 text-subhead leading-snug">
      {/* Step 1152 — the one position cell every stage shares. */}
      <PositionCell position={row.item.source.position} />
      {/* ⚠️ `gap-3` — the Match row's column, class for class (Step 1156,
          operator: "add gap-3 between Item name and product. The same is done
          in 2. match page."). This is the same line one stage later, so its
          product hangs the same 12px under its name; it was `gap-1` here while
          the Match row took `gap-3` at Step 1097. */}
      <span className="flex min-w-0 flex-1 flex-col gap-3">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 text-foreground">{row.item.source.name}</span>
          {qtyLabel ? <span className="shrink-0 text-muted-foreground">{qtyLabel}</span> : null}
        </span>
        {/* The option, then its money — sideways-scrolling like the Match row
            (Step 1097), every field `shrink-0` so nothing is clipped.
            Step 1113 — the line's `pl-6` indent is now a SLOT (`w-4` + the
            `gap-2` = the same 24px): the warning sign sits IN it, left of the
            code, and the slot stays when there is no sign so the code column
            lines up sign or no sign. */}
        {/* Step 1157 — the fields line and, under it, the price list's own
            name for the article, 4px apart (the Match row's spacing): the two
            lines are one candidate, so they sit closer to each other than the
            column's `gap-3` puts them to the line's name. */}
        <span className="flex min-w-0 flex-col gap-1">
          <span className="no-scrollbar flex items-baseline gap-2 overflow-x-auto text-muted-foreground">
            {note ? (
              <span
                className="inline-flex w-4 shrink-0 items-center self-center text-warn"
                title={note}
                aria-label={note}
                role="img"
              >
                <AlertTriangleIcon size={14} aria-hidden="true" />
              </span>
            ) : (
              <span className="w-4 shrink-0" aria-hidden="true" />
            )}
            <span className="shrink-0">{row.match.code || row.match.name}</span>
            {row.match.brand ? <span className="shrink-0">· {row.match.brand}</span> : null}
            <span
              className="shrink-0 tabular-nums"
              title={`${row.price.label || "price"} — ${row.price.sourceFile}${row.price.itemName ? `: ${row.price.itemName}` : ""}`}
            >
              · {formatMoney(row.price.value, locale)} {row.price.currency}
            </span>
            {/* Step 1112 — the discount and the net price for ONE piece; the
              quantity and the line total left the row (operator's call). The
              quantity still stands on the name line, and the total below still
              sums net × quantity, so nothing is lost — only repeated. */}
            {o.kind === "applied" ? (
              <>
                <span className="shrink-0 tabular-nums">· −{o.percent}%</span>
                <span className="shrink-0 font-semibold text-foreground tabular-nums">
                  {formatMoney(o.net, locale)} {row.price.currency}
                </span>
              </>
            ) : null}
          </span>
          {/* `pl-6` = the warning slot's `w-4` + the line's `gap-2`: the name
            starts under the CODE, as it starts under the score on the Match row. */}
          {row.price.itemName ? (
            <OptionItemName name={row.price.itemName} className="pl-6" />
          ) : null}
        </span>
      </span>
    </li>
  );
}

/** The "look again" icon — after adding groups or clients to the table. */
function ReloadButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(iconButtonClass(), "h-8 w-8 shrink-0 rounded-chip")}
      title="Look for the discount table again — after adding groups or clients to it."
      aria-label="Reload the discount table"
    >
      <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}
