"use client";

/**
 * Pricing in Plugent's own look (the design canvas's Pricing board): stage tabs in the run
 * header, totals as tiles, each stage's lines as ONE table with column headings, and one pill
 * action under it.
 *
 * ⚠️ ONLY THE PRESENTATION IS PLUGENT'S. Every figure, filter and guard comes from sebtember's
 * code copied verbatim (`lib/agents/ipl/*`, `lib/pricing/confirm.ts`): which options are shown
 * (`pricedOptionsOf`), the totals and their coverage notes (`summariseSelection`,
 * `summariseDiscounts`), the quantity wording (`formatQuantity`). Fix a figure there, in
 * sebtember first; restyle it here.
 */
import { AlertTriangleIcon, CheckIcon, Loader2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  countNotSearched,
  formatMoney,
  type IplOption,
  noMatchKind,
  pricedOptionsOf,
  summarise,
  summariseSelection,
} from "@/lib/agents/ipl/derive";
import { type DiscountClient, discountNote, summariseDiscounts } from "@/lib/agents/ipl/discount";
import { IPL_MAX_MATCHES, type IplResult, type IplResultItem } from "@/lib/agents/ipl/types";
import type { MoiSourceItem } from "@/lib/agents/moi/types";
import { formatQuantity } from "@/lib/pricing/confirm";
import { documentLocale } from "@/lib/pricing/document";
import { cn } from "@/lib/utils";

export type PricingStage = 1 | 2 | 3;

const STAGES: ReadonlyArray<{ step: PricingStage; label: string; locked: string }> = [
  { step: 1, label: "Extract", locked: "" },
  { step: 2, label: "Match", locked: "Confirm the lines first. Matching runs from them." },
  { step: 3, label: "Price", locked: "Finish the match first. The list is priced from it." },
];

/** The three stages as a pill switch, in the run header. A stage not reached yet is locked. */
export function StageTabs({
  current,
  reached,
  running,
  onSelect,
  className,
}: {
  className?: string;
  current: PricingStage;
  reached: PricingStage;
  running: boolean;
  onSelect: (step: PricingStage) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Stages"
      className={cn("inline-flex shrink-0 gap-0.5 rounded-full bg-fill1 p-[3px]", className)}
    >
      {STAGES.map(({ step, label, locked: why }) => {
        const active = step === current;
        const locked = step > reached && !active;
        const done = step < reached && !active;
        return (
          <button
            key={step}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={locked}
            title={locked ? why : undefined}
            onClick={() => onSelect(step)}
            className={cn(
              "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] whitespace-nowrap",
              active
                ? "bg-raised font-bold text-ink shadow-card"
                : "font-semibold text-ink2 hover:text-ink disabled:opacity-55 disabled:hover:text-ink2",
            )}
          >
            {running && step === 2 ? (
              <Loader2Icon aria-hidden size={14} className="animate-spin" />
            ) : done ? (
              <CheckIcon aria-hidden size={14} strokeWidth={2.4} />
            ) : null}
            {step} {label}
          </button>
        );
      })}
    </div>
  );
}

export interface TileSpec {
  label: string;
  value: ReactNode;
  tone?: "ok" | "warn";
  /** A word-sized value (a file name, a client) rather than a figure. */
  small?: boolean;
  title?: string;
}

/** The stage's totals, as tiles above its table. */
export function Tiles({ tiles }: { tiles: TileSpec[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
      {tiles.map((t) => (
        <div
          key={t.label}
          title={t.title}
          className="flex min-w-0 flex-col gap-0.5 rounded-list bg-card px-[18px] py-3.5 shadow-card"
        >
          <span className="text-[13px] text-ink2">{t.label}</span>
          {t.small ? (
            <span className="truncate pt-1.5 text-[15px] leading-[22px] font-semibold">
              {t.value}
            </span>
          ) : (
            <span
              className={cn(
                "truncate text-[28px] leading-[34px] font-bold tabular-nums",
                t.tone === "ok" && "text-ok",
                t.tone === "warn" && "text-warn",
              )}
            >
              {t.value}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** The stage's one way forward: what it will do, then a large pill. */
export function StageAction({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
      {note ? <span className="text-[13px] text-ink2">{note}</span> : null}
      {children}
    </div>
  );
}

export const PILL =
  "inline-flex h-[52px] items-center justify-center gap-2 rounded-full bg-act px-7 text-[17px] font-bold text-white hover:bg-act-press disabled:opacity-50";
export const PILL_QUIET =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-fill2 px-5 text-[15px] font-semibold text-ink hover:bg-sel hover:text-link disabled:opacity-50";

/** A table card: column headings, rows; scrolls sideways on a phone rather than squeezing. */
function TableCard({
  columns,
  minWidth,
  head,
  children,
}: {
  columns: string;
  minWidth: number;
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-list bg-card shadow-card">
      <div style={{ minWidth }}>
        <div
          className="grid items-center gap-3 border-hair border-b-[0.5px] px-4 py-2.5 text-[13px] font-semibold text-ink2"
          style={{ gridTemplateColumns: columns }}
        >
          {head}
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({
  columns,
  first,
  joined,
  tone,
  children,
}: {
  columns: string;
  first: boolean;
  /** Belongs to the line above (another option, a missing part): no rule between. */
  joined?: boolean;
  tone?: "warn";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid items-start gap-3 px-4",
        joined ? "pb-3" : "py-3",
        !first && !joined && "border-hair border-t-[0.5px]",
        tone === "warn" && "bg-warn/8",
      )}
      style={{ gridTemplateColumns: columns }}
    >
      {children}
    </div>
  );
}

/** The document's own position, four characters at most (sebtember's Step 1154 rule). */
function Pos({ position }: { position?: string }) {
  const text = position ?? "";
  return (
    <span
      className="overflow-hidden pt-px text-[13px] whitespace-nowrap text-ink2 tabular-nums"
      title={text.length > 4 ? text : undefined}
    >
      {text.slice(0, 4)}
    </span>
  );
}

/* --------------------------------------------------------------------- extract */

const EXTRACT_COLS = "28px 44px minmax(0,3fr) minmax(0,2fr) 96px";

/** Stage 1: every line the read found, ticked to be matched. */
export function ExtractTable({
  items,
  indices,
  selected,
  onToggle,
  allChecked,
  onToggleAll,
}: {
  items: MoiSourceItem[];
  /** Each visible row's index in the stored list (the selection is kept under it). */
  indices: number[];
  selected: ReadonlySet<number>;
  onToggle: (index: number) => void;
  allChecked: boolean;
  onToggleAll: (on: boolean) => void;
}) {
  return (
    <TableCard
      columns={EXTRACT_COLS}
      minWidth={640}
      head={
        <>
          <Checkbox
            size="sm"
            checked={allChecked}
            onChange={() => onToggleAll(!allChecked)}
            aria-label="Include every line"
          />
          <span>Pos.</span>
          <span>Your line</span>
          <span>Code and details</span>
          <span className="text-right">Qty</span>
        </>
      }
    >
      {items.map((it, i) => {
        const index = indices[i] ?? i;
        const kept = selected.has(index);
        const detail = [it.code, it.specs].filter(Boolean).join(" · ");
        return (
          <Row key={index} columns={EXTRACT_COLS} first={i === 0}>
            <Checkbox
              size="sm"
              checked={kept}
              onChange={() => onToggle(index)}
              aria-label={`Include ${it.name}`}
            />
            <Pos position={it.position} />
            <span className={cn("text-[15px] leading-[22px]", !kept && "text-ink2 line-through")}>
              {it.name}
            </span>
            <span className="line-clamp-2 text-[13px] leading-5 text-ink2" title={detail}>
              {detail}
            </span>
            <span className="text-right text-[15px] leading-[22px] tabular-nums">
              {formatQuantity(it) ?? ""}
            </span>
          </Row>
        );
      })}
    </TableCard>
  );
}

/* ----------------------------------------------------------------------- match */

const MATCH_COLS = "28px 44px minmax(0,2fr) 80px minmax(0,2fr) 116px 52px";

const NO_MATCH: Record<ReturnType<typeof noMatchKind>, { text: string; title: string }> = {
  not_searched: {
    text: "Not searched, the search failed",
    title:
      "Your documents returned nothing for this line, even after a retry. That is a search failure, not evidence the product is unavailable. Price the list again.",
  },
  not_a_product: {
    text: "Not a product, skipped",
    title:
      "This line reads as a bulk material or labour rather than a product, so it was not searched.",
  },
  not_found: {
    text: "No match in your catalogues",
    title: "Your documents were searched and nothing in them matched this line.",
  },
};

/** Match tiles: what the read found, what matched, what needs the user, which price lists. */
export function matchTiles(result: IplResult): TileSpec[] {
  const s = summarise(result);
  const unpriced = result.items.filter((i) => pricedOptionsOf(i, IPL_MAX_MATCHES).length === 0);
  const notSearched = countNotSearched(result);
  const lists = [
    ...new Set(
      result.items.flatMap((i) => [
        ...i.prices.map((p) => p.sourceFile),
        ...(i.alternatives ?? []).flatMap((a) => a.prices.map((p) => p.sourceFile)),
      ]),
    ),
  ];
  return [
    { label: "Lines", value: s.total },
    { label: "Matched", value: s.matched, tone: "ok" },
    {
      label: "No price",
      value: unpriced.length,
      tone: unpriced.length > 0 ? "warn" : undefined,
      title: "Lines with no price in your price lists. They stay on the sheet.",
    },
    ...(notSearched > 0
      ? [
          {
            label: "Not searched",
            value: notSearched,
            tone: "warn" as const,
            title:
              "The search returned nothing for these lines, even after a retry. That is a search failure, not evidence the products are unavailable. Price the list again.",
          },
        ]
      : []),
    {
      label: lists.length === 1 ? "Price list" : "Price lists",
      value: lists.length > 0 ? lists.join(", ") : "None",
      small: true,
      title: lists.join("\n"),
    },
  ];
}

/** Stage 2: each line with the products it matched, every priced option ticked into the total. */
export function MatchTable({
  result,
  selected,
  onToggleOption,
  onToggleAll,
}: {
  result: IplResult;
  selected: ReadonlyMap<number, ReadonlySet<number>>;
  onToggleOption: (itemIndex: number, optionIndex: number) => void;
  onToggleAll: (on: boolean) => void;
}) {
  const locale = documentLocale(result.lang);
  const lines = result.items.map((item, index) => ({
    item,
    index,
    options: pricedOptionsOf(item, IPL_MAX_MATCHES),
  }));
  const priceable = lines.filter((l) => l.options.length > 0);
  const allTicked =
    priceable.length > 0 &&
    priceable.every(({ index, options }) =>
      options.every((o) => selected.get(index)?.has(o.index) ?? false),
    );
  let rowCount = 0;

  return (
    <TableCard
      columns={MATCH_COLS}
      minWidth={860}
      head={
        <>
          {priceable.length > 0 ? (
            <Checkbox
              size="sm"
              checked={allTicked}
              onChange={() => onToggleAll(!allTicked)}
              aria-label="Tick every price"
            />
          ) : (
            <span />
          )}
          <span>Pos.</span>
          <span>Your line</span>
          <span className="text-right">Qty</span>
          <span>Best match</span>
          <span className="text-right">Price</span>
          <span className="text-right">Match</span>
        </>
      }
    >
      {lines.map(({ item, index, options }) => {
        const first = rowCount++ === 0;
        if (options.length === 0) return <UnpricedRow key={index} item={item} first={first} />;
        const ticked = selected.get(index);
        return (
          <div key={index}>
            {options.map((o, n) => (
              <OptionRow
                key={o.index}
                item={item}
                option={o}
                lead={n === 0}
                first={first && n === 0}
                checked={ticked?.has(o.index) ?? false}
                onToggle={() => onToggleOption(index, o.index)}
                locale={locale}
              />
            ))}
            {(item.partsNotFound ?? []).map((part) => (
              <Row key={part} columns={MATCH_COLS} first={false} joined tone="warn">
                <span />
                <span />
                <span />
                <span />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] leading-[22px] font-semibold text-warn">
                    No match for {part}
                  </span>
                  <span className="text-[12px] leading-4 text-ink2">
                    Part of this set. Add it by hand.
                  </span>
                </span>
                <span />
                <span />
              </Row>
            ))}
          </div>
        );
      })}
    </TableCard>
  );
}

function OptionRow({
  item,
  option,
  lead,
  first,
  checked,
  onToggle,
  locale,
}: {
  item: IplResultItem;
  option: IplOption;
  /** The line's first option carries the line itself (position, name, quantity). */
  lead: boolean;
  first: boolean;
  checked: boolean;
  onToggle: () => void;
  locale: string;
}) {
  const price = option.price;
  const off = !checked && "text-ink2 line-through";
  return (
    <Row columns={MATCH_COLS} first={first} joined={!lead}>
      <Checkbox
        size="sm"
        checked={checked}
        onChange={onToggle}
        aria-label={`Include ${option.match.code || option.match.name}`}
      />
      {lead ? <Pos position={item.source.position} /> : <span />}
      <span className="text-[15px] leading-[22px]">{lead ? item.source.name : ""}</span>
      <span className="text-right text-[15px] leading-[22px] tabular-nums">
        {lead ? (formatQuantity(item.source) ?? "") : ""}
      </span>
      <span
        className="flex min-w-0 flex-col gap-0.5"
        title={option.match.part ? `Part of the set: ${option.match.part}` : undefined}
      >
        <span className={cn("text-[15px] leading-[22px] font-semibold", off)}>
          {[option.match.code || option.match.name, option.match.brand].filter(Boolean).join(" · ")}
        </span>
        {price?.itemName ? (
          <span className={cn("text-[12px] leading-4 text-ink2", off)}>{price.itemName}</span>
        ) : null}
      </span>
      <span
        className={cn("text-right text-[15px] leading-[22px] tabular-nums", off)}
        title={
          price
            ? `${price.label || "price"}${price.unit ? ` (${price.unit})` : ""}, ${price.sourceFile}`
            : undefined
        }
      >
        {price ? `${formatMoney(price.value, locale)} ${price.currency}` : ""}
      </span>
      <span className="pt-0.5 text-right text-[13px] font-semibold text-ink2 tabular-nums">
        {option.match.percent}%
      </span>
    </Row>
  );
}

function UnpricedRow({ item, first }: { item: IplResultItem; first: boolean }) {
  const kind = noMatchKind(item);
  const skipped = kind === "not_a_product" && !item.match;
  const said = item.match
    ? {
        text: [item.match.code || item.match.name, item.match.brand].filter(Boolean).join(" · "),
        sub: "No price in your price lists. It stays on the sheet.",
        title: undefined,
      }
    : { text: NO_MATCH[kind].text, sub: "It stays on the sheet.", title: NO_MATCH[kind].title };
  return (
    <Row columns={MATCH_COLS} first={first} tone={skipped ? undefined : "warn"}>
      <span />
      <Pos position={item.source.position} />
      <span className="text-[15px] leading-[22px]">{item.source.name}</span>
      <span className="text-right text-[15px] leading-[22px] tabular-nums">
        {formatQuantity(item.source) ?? ""}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5" title={said.title}>
        <span
          className={cn(
            "text-[15px] leading-[22px] font-semibold",
            skipped ? "text-ink2" : "text-warn",
          )}
        >
          {said.text}
        </span>
        <span className="text-[12px] leading-4 text-ink2">{said.sub}</span>
      </span>
      <span />
      <span className="pt-0.5 text-right text-[13px] font-semibold text-ink2 tabular-nums">
        {item.match ? `${item.match.percent}%` : ""}
      </span>
    </Row>
  );
}

/** How many lines the Match ticks price, for the stage's action. */
export function pricedLineCount(
  result: IplResult,
  selected: ReadonlyMap<number, ReadonlySet<number>>,
): number {
  return summariseSelection(result, selected, IPL_MAX_MATCHES).priced;
}

/* ----------------------------------------------------------------------- price */

const PRICE_COLS_NET = "44px minmax(0,2fr) 72px minmax(0,2fr) 100px 56px 100px 112px";
const PRICE_COLS_LIST = "44px minmax(0,2fr) 72px minmax(0,2fr) 100px 112px";

/** Price tiles: the total, before the discount, for whom, and how many lines. */
export function priceTiles(
  result: IplResult,
  selected: ReadonlyMap<number, ReadonlySet<number>>,
  client: DiscountClient | null,
): TileSpec[] {
  const locale = documentLocale(result.lang);
  const summary = summariseDiscounts(result, selected, IPL_MAX_MATCHES, client);
  const money = (pick: "net" | "list") =>
    summary.totals.length === 0
      ? "—"
      : summary.totals.map((t) => `${formatMoney(t[pick], locale)} ${t.currency}`).join(" + ");
  return [
    {
      label: client ? "Total after discount" : "Total",
      value: money("net"),
      title: summary.totals.length > 1 ? "One figure per currency." : undefined,
    },
    ...(client ? [{ label: "List price", value: money("list"), small: true }] : []),
    { label: "Priced for", value: client?.name ?? "List prices", small: true },
    { label: "Lines priced", value: summariseSelection(result, selected, IPL_MAX_MATCHES).priced },
  ];
}

/** Stage 3: the ticked options priced, discounted for the chosen client, with the total. */
export function PriceTable({
  result,
  selected,
  client,
  footer,
}: {
  result: IplResult;
  selected: ReadonlyMap<number, ReadonlySet<number>>;
  client: DiscountClient | null;
  footer?: ReactNode;
}) {
  const locale = documentLocale(result.lang);
  const summary = summariseDiscounts(result, selected, IPL_MAX_MATCHES, client);
  const guards = summariseSelection(result, selected, IPL_MAX_MATCHES);
  const withNet = client !== null;
  const cols = withNet ? PRICE_COLS_NET : PRICE_COLS_LIST;
  const uncovered = [...summary.uncovered.values()].reduce((s, n) => s + n, 0);

  if (summary.rows.length === 0) {
    return (
      <div className="rounded-list bg-card px-5 py-4 shadow-card">
        <p className="text-[15px] text-ink2">
          Nothing is ticked on the Match stage, so there is nothing to price.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <TableCard
        columns={cols}
        minWidth={withNet ? 900 : 780}
        head={
          <>
            <span>Pos.</span>
            <span>Your line</span>
            <span className="text-right">Qty</span>
            <span>Product</span>
            <span className="text-right">List price</span>
            {withNet ? <span className="text-right">Disc.</span> : null}
            {withNet ? <span className="text-right">Net price</span> : null}
            <span className="text-right">Line total</span>
          </>
        }
      >
        {summary.rows.map((r, i) => {
          const o = r.outcome;
          const note = withNet ? discountNote(o) : "";
          const sameLine = i > 0 && summary.rows[i - 1]?.itemIndex === r.itemIndex;
          return (
            <Row
              key={`${r.itemIndex}:${r.optionIndex}`}
              columns={cols}
              first={i === 0}
              joined={sameLine}
            >
              {sameLine ? <span /> : <Pos position={r.item.source.position} />}
              <span className="text-[15px] leading-[22px]">
                {sameLine ? "" : r.item.source.name}
              </span>
              <span className="text-right text-[15px] leading-[22px] tabular-nums">
                {sameLine ? "" : (formatQuantity(r.item.source) ?? "")}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-[15px] leading-[22px] font-semibold">
                  {note ? (
                    <AlertTriangleIcon
                      size={14}
                      className="shrink-0 text-warn"
                      aria-label={note}
                      role="img"
                    />
                  ) : null}
                  {[r.match.code || r.match.name, r.match.brand].filter(Boolean).join(" · ")}
                </span>
                {r.price.itemName ? (
                  <span className="text-[12px] leading-4 text-ink2">{r.price.itemName}</span>
                ) : null}
                {note ? <span className="text-[12px] leading-4 text-warn">{note}</span> : null}
              </span>
              <span
                className={cn(
                  "text-right text-[15px] leading-[22px] tabular-nums",
                  withNet && o.kind === "applied" && "text-ink2",
                )}
                title={`${r.price.label || "price"}, ${r.price.sourceFile}`}
              >
                {formatMoney(r.price.value, locale)}
              </span>
              {withNet ? (
                <span className="text-right text-[15px] leading-[22px] text-ink2 tabular-nums">
                  {o.kind === "applied" ? `−${o.percent}%` : ""}
                </span>
              ) : null}
              {withNet ? (
                <span className="text-right text-[15px] leading-[22px] tabular-nums">
                  {o.kind === "applied"
                    ? formatMoney(o.net, locale)
                    : formatMoney(r.price.value, locale)}
                </span>
              ) : null}
              <span className="text-right text-[15px] leading-[22px] font-semibold tabular-nums">
                {formatMoney(r.lineNet, locale)} {r.price.currency}
              </span>
            </Row>
          );
        })}
        <div className="flex flex-wrap items-start justify-between gap-3 border-hair border-t-[0.5px] bg-fill1 px-4 py-3.5">
          <span className="text-[15px] font-semibold">Total</span>
          <span className="flex flex-col items-end gap-0.5">
            {summary.totals.map((t) => (
              <span key={t.currency || "?"} className="flex items-baseline gap-3 tabular-nums">
                {withNet ? (
                  <span className="text-[15px] text-ink2 line-through">
                    {formatMoney(t.list, locale)} {t.currency}
                  </span>
                ) : null}
                <span className="text-[20px] font-bold">
                  {formatMoney(t.net, locale)} {t.currency}
                </span>
              </span>
            ))}
            <span className="text-right text-[13px] text-ink2">
              {withNet ? (
                <>
                  discount on {summary.applied}/{summary.rows.length} rows
                  {uncovered > 0 ? (
                    <span
                      className="text-warn"
                      title={`Groups not in the table for this client: ${[...summary.uncovered.keys()].join(", ")}. Add them to the discount table to price these rows.`}
                    >
                      {" "}
                      · {uncovered} at list price
                    </span>
                  ) : null}
                  {summary.noGroup > 0 ? (
                    <span title="These prices carry no discount group: the price list has none.">
                      {" "}
                      · {summary.noGroup} without a group
                    </span>
                  ) : null}
                </>
              ) : (
                <>list prices · {summary.rows.length} rows</>
              )}
              {guards.labels.length > 1 ? (
                <span
                  className="text-warn"
                  title={`This figure mixes columns that mean different things: ${guards.labels.join(", ")}.`}
                >
                  {" "}
                  · mixed basis
                </span>
              ) : null}
              {guards.multiOptionLines > 0 ? (
                <span title="These lines contributed more than one price, so the figure counts them more than once. Untick the options you do not want on the Match stage.">
                  {" "}
                  · {guards.multiOptionLines}{" "}
                  {guards.multiOptionLines === 1 ? "line counts" : "lines count"} more than once
                </span>
              ) : null}
              {guards.assumedQty > 0 ? <span> · {guards.assumedQty} qty assumed</span> : null}
            </span>
          </span>
        </div>
      </TableCard>
      {footer}
    </div>
  );
}
