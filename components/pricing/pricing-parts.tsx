"use client";

/**
 * The PRICING presentational parts (Step 973) — extracted verbatim from
 * `components/chat/IplRunCard.tsx`.
 *
 * ⚠️ ONE IMPLEMENTATION, TWO SURFACES. The chat agent's card and the PRICING
 * section's page render the same priced table, the same per-column toggles, the
 * same coverage/currency/basis guards and the same export. Two copies of a
 * table whose whole job is to keep a total honest is exactly the drift this
 * codebase keeps paying for — Step 940 moved Copy/Share out of `AgentRunsView`
 * for the same reason.
 *
 * ⚠️ NOTHING WAS REDESIGNED IN THE MOVE. These are the Steps 724–727 components
 * with `export` added; the reasoning that earned each guard lives in the
 * comments below, unchanged.
 *
 * Everything here is PURE presentation over an `IplResult` — no listener, no
 * fetch, no knowledge of where the run is stored. That is what lets the page
 * mount it over a `pricings/{id}` doc and the card mount it over an
 * `agentRuns/{id}` one.
 */
import { FileSpreadsheetIcon, Loader2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { iconButtonClass } from "@/components/ui/icon-button";
import {
  countNotSearched,
  defaultSelection,
  formatMoney,
  type IplNoMatchKind,
  type IplOption,
  type IplSelectionSummary,
  noMatchKind,
  pricedOptionsOf,
  summarise,
  summariseSelection,
} from "@/lib/agents/ipl/derive";
import { downloadIplXlsx, type IplExportDiscount } from "@/lib/agents/ipl/export";
import { IPL_MAX_MATCHES, type IplResult, type IplResultItem } from "@/lib/agents/ipl/types";
import type { MoiSourceItem } from "@/lib/agents/moi/types";
import { formatQuantity, type PricingCoverage } from "@/lib/pricing/confirm";
import { documentLocale } from "@/lib/pricing/document";
import { cn } from "@/lib/utils";

export function IplDownloads({
  result,
  selected,
  fileBase,
  feedback,
  discount,
  className,
}: {
  result: IplResult;
  /**
   * ⚠️ THE SAME SELECTION THE CARD RENDERS (Step 1086). The sheet used to
   * take a COLUMN list while the card took a hidden-column set - two ways of
   * saying the same thing, so a change to one could silently leave the other
   * describing a different table. One value, one source of truth.
   */
  selected: ReadonlyMap<number, ReadonlySet<number>>;
  fileBase: string;
  /**
   * ⚠️ A NODE, not ids. Feedback on an agent RUN is addressed by
   * roomId/messageId/runId (`AgentFeedbackTarget`), which a PRICING doc does
   * not have and should not fake. Passing the button in keeps this component
   * surface-agnostic instead of teaching it about chat rooms; the page passes
   * nothing, which is honest — there is no run to report on.
   */
  feedback?: React.ReactNode;
  /**
   * Step 1110 — the Price step's sheet: the same table plus the five discount
   * columns, named `-pricelist.xlsx` (Step 1104). Absent on the Match step, so
   * that stage's sheet stays byte-identical to what it was.
   */
  discount?: IplExportDiscount;
  /**
   * The caller's own box — the rule this file already follows for `ItemList`
   * and `IplResultView`, for the same reason.
   *
   * ⚠️ THE DEFAULT IS THE OLD BOX, DELIBERATELY. `IplRunCard` — the RETIRED
   * chat agent (Step 974) — renders these downloads on their OWN row below its
   * card and needs the `mt-2` that separates them from it. PRICING (Step 1094)
   * lifts the button up into the "Source:" row instead, where an `mt-2` would
   * knock it out of vertical centre. Baking either in forces the other to be
   * wrong, so the caller says.
   */
  className?: string;
}) {
  return (
    <div className={cn("mt-2 flex items-center justify-end gap-2", className)}>
      {feedback ?? null}
      {/* ⚠️ CSV IS GONE (operator's call) — XLS is the one download. The two
          offered the same table in two formats, and the sheet is the format the
          guards were written for: `downloadIplXlsx` needs no formula guard at
          all, because a string-typed XLSX cell is never evaluated, where a CSV
          cell opening `=` IS a formula to Excel and has to be escaped.

          ⚠️ `downloadIplCsv` IS KEPT, not deleted, and that is worth stating
          rather than leaving to be rediscovered: it is now referenced by no
          surface, and it is the ONLY production caller of
          `lib/agents/csv-safe.ts`. Deleting it would strand that security
          module with nothing but its own eval calling it — a bigger decision
          than removing a button, and one `lib/pricing/source-export.ts`
          already anticipates re-opening ("the moment a CSV twin is added it
          needs `csvCell`"). Both builders still share `buildIplTable`, so the
          Step-726/734/815 guards are exercised either way. */}
      <ExportButton
        label="XLS"
        icon={<FileSpreadsheetIcon size={15} aria-hidden="true" />}
        onClick={() => void downloadIplXlsx(result, selected, IPL_MAX_MATCHES, fileBase, discount)}
      />
    </div>
  );
}

/**
 * Icon+label pill, matching MOI's export buttons.
 *
 * ⚠️ EXPORTED at Step 1064 so the confirm step's download reuses it rather
 * than growing a second spelling of the same control — the rule this file
 * already follows for the list, the table and the coverage note.
 */
export function ExportButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        iconButtonClass(),
        "inline-flex h-8 w-auto items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export function StatusLine({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/**
 * The position column — ONE cell for every stage (Steps 1152 / 1154).
 *
 * ⚠️ FIXED AT FOUR CHARACTERS, operator's ask, and it REVERSES the rule the
 * three sites used to carry ("`min-w`, not `w`: a position is an IDENTIFIER, so
 * it may grow but must never be clipped"). What changed the call: a bill of
 * quantities groups a set on one row — `M28, M29, M30, M31, M32, M33 |
 * Manometras su trieigiu čiaupu | 6 vnt.` — and a column that grows to fit it
 * pushes every name on the card out of the reading line. Step 1063 stacked the
 * fields so a scan down the list reads ONE column of names; a 200px position
 * cell on one row breaks exactly that.
 *
 * ⚠️ Step 1154 — `w-10` (2.5rem) AND NO ELLIPSIS, operator's second look:
 * *"Positions still requires a lot of space. Let's fix up to 4 characters and
 * without elipses."* Step 1152 shipped `w-12` for one reason only — at 2.5rem
 * `truncate` clipped the grouped `M28, M29, …` to `M2…`, because the ellipsis
 * glyph takes a character's room. Drop the ellipsis and that reason goes with
 * it: four characters is what the column is FOR, so the cell is exactly four
 * characters wide (the 2.5rem the stages shared from Step 1074 to 1152) and a
 * longer position is CUT to its first four, not ellipsised — `M28,` / `ŠS1,`.
 * Measured on the rendered card: `R-12`, `1.28`, `AT1` still render whole at
 * 40px, and the cut is made in the TEXT as well as the box (see below).
 *
 * ⚠️ THE CUT IS THE POINT, not a regression to hide. An ellipsis says "there is
 * more" in the one place the column cannot afford a character, and the hover
 * says it better: `title` carries the whole identifier, the export prints it in
 * full (Step 1102), and only a position LONGER than four characters gets the
 * tooltip — a title on every row would be noise on the rows that need none.
 *
 * ⚠️ `text-clip` IS THE DEFAULT, AND IT IS WRITTEN OUT ANYWAY — `truncate` is
 * `overflow-hidden text-ellipsis whitespace-nowrap`, so the class had to be
 * spelled out to drop ONE of its three halves; naming `text-clip` is what says
 * the absence is a decision rather than an omission (and it survives a future
 * `truncate` creeping back through `cn()`, which would otherwise win on
 * emitted order). The cell must stay a block-level flex child for the clip to
 * apply (a `span` in a flex row is one). `drive-step-1152.ts` measures the
 * rendered cell: 40px on every row, `text-overflow: clip`, the long one cut
 * and titled, the short ones whole and untitled, every name on one left edge.
 */
export const POSITION_CELL_CLASS =
  "w-10 shrink-0 overflow-hidden text-clip whitespace-nowrap tabular-nums text-muted-foreground";

/** Step 1154 — how many characters of a position the column shows. */
export const POSITION_MAX_CHARS = 4;

export function PositionCell({ position }: { position?: string }) {
  const text = position ?? "";
  const long = text.length > POSITION_MAX_CHARS;
  return (
    <span className={POSITION_CELL_CLASS} title={long ? text : undefined} data-position-cell="">
      {/* ⚠️ Step 1154 — CUT IN THE TEXT, not only by the box. Clipping on width
          alone left a sliver of the fifth glyph (`M28, |`) — an ellipsis' worth
          of noise without an ellipsis' meaning. Slicing to four characters
          renders `M28,` cleanly and makes the column's promise exact; the
          `overflow-hidden` on the class stays as the backstop for four WIDE
          characters, which no real position has. */}
      {long ? text.slice(0, POSITION_MAX_CHARS) : text}
    </span>
  );
}

/**
 * The confirmed line list.
 *
 * ⚠️ SELECTION IS OPT-IN. `selected`/`onToggle` are optional and, without them,
 * this renders exactly what it always did — which is what `IplRunCard` (the
 * RETIRED chat agent, Step 974) still needs for its past runs. Same shape as
 * `ProviderSourceRow`'s optional `source` (Step 1007): a surface with no way to
 * honour a control does not get the control.
 *
 * ⚠️ KEYED BY INDEX, and it had to change. The key was `name|code`, which is
 * NOT unique in a bill of quantities — four valve sizes share one name, the
 * exact reason `MoiResultRow` keys on the index. The list is static: never
 * sorted, filtered or reordered after render.
 */
export function ItemList({
  items,
  indices,
  selected,
  onToggle,
  className,
}: {
  items: MoiSourceItem[];
  /**
   * Step 1081 — the CANONICAL index of each rendered row, when the caller is
   * showing a subset.
   *
   * ⚠️ WITHOUT THIS, HIDING A ROW SILENTLY RE-AIMS EVERY CHECKBOX BELOW IT.
   * `selected` and `onToggle` speak in indices into the STORED `source_items`
   * array — that is what the run's `keep` is applied against, server-side — so
   * a filtered `items` array whose positions were used as indices would tick
   * one row and price another. Defaults to positional, so `IplRunCard` (which
   * shows every row and passes nothing) is unchanged.
   */
  indices?: number[];
  /** Indices the user kept. Absent = not selectable. */
  selected?: Set<number>;
  onToggle?: (index: number) => void;
  /**
   * The caller's own box and text scale.
   *
   * ⚠️ THIS LIST OWNS NO CHROME, and that is what lets one component serve two
   * surfaces that must NOT look alike. PRICING renders it inside the chat
   * answer card at chat's own text size; `IplRunCard` — the RETIRED chat agent
   * (Step 974) — renders it as a small inset panel inside a run card, where a
   * second card would nest. Baking either one in forces the other to be wrong.
   */
  className?: string;
}) {
  const selectable = selected !== undefined && onToggle !== undefined;
  // ONE row markup either way — a `label` when it can be ticked, a plain `span`
  // when it cannot. Two branches around the same three spans is how the
  // selectable and read-only renderings would drift.
  const Row = selectable ? "label" : "span";
  // Computed once rather than twice per row — the gate and the text are the
  // same value, which is the point of `formatQuantity` returning null.
  const quantityLabels = items.map((it) => formatQuantity(it));
  // Positional by default, so a caller showing every row passes nothing.
  const canonical = (i: number) => indices?.[i] ?? i;
  // ⚠️ Step 1082 — ONE selection value per row, resolved here rather than at
  // each reader. `selected` has THREE readers (the checkbox's `checked`, its
  // `onChange`, and the name's strikethrough), and Step 1081 fixed two of them:
  // the name kept reading the RAW position, so on a card that lists a subset a
  // perfectly well ticked row rendered struck through. Two readers of one
  // selection can disagree; one value cannot — the same reasoning that makes
  // `formatQuantity` return null as both the gate and the text.
  const isKept = (i: number) => selected?.has(canonical(i)) ?? true;
  return (
    // A rule BETWEEN rows, never a box around each: the list has to stay
    // scannable at 100+ lines, so one border per boundary rather than per row.
    //
    // ⚠️ NOT `divide-y`. It is the obvious utility for this and it emits
    // NOTHING in this project — grepped the built CSS: zero occurrences of
    // "divide" while `.border-hairline` and `.rounded-card` are both there. It
    // passes tsc, biome AND the build and renders as no rule at all, which is
    // the Step-728 failure exactly. Caught by MEASURING borderTopWidth (0px),
    // never by reading. The arbitrary variant below is plain `border-t` +
    // `border-color`, both core utilities that provably generate.
    <ul className={cn("flex flex-col [&>li+li]:border-t [&>li+li]:border-hairline", className)}>
      {items.map((it, i) => (
        // `name|code` is NOT unique in a bill of quantities (four valve sizes
        // share one name) — the exact reason MoiResultRow keys on the index
        // too. The list is static: never sorted or reordered.
        //
        // ⚠️ THE KEY STAYS POSITIONAL while `selected` / `onToggle` use the
        // CANONICAL index. React keys only need to be unique within THIS list,
        // and a filtered list's positions are; selection has to survive the
        // trip to the server, and only the canonical index does.
        //
        // ⚠️ THE DIRECTIVE MUST BE THE LAST COMMENT LINE. Step 1033 recorded
        // that this suppression "does not take effect in this version"; it
        // does — it was simply separated from the node by the continuation
        // lines that used to follow it, which biome does not look past.
        // biome-ignore lint/suspicious/noArrayIndexKey: static list, see above
        <li key={i}>
          <Row
            className={cn(
              // `items-start`, not `items-baseline`: a 15px name wraps on a
              // narrow viewport, and baseline alignment would hang the
              // checkbox off the LAST line of a wrapped row.
              "flex items-start gap-2.5 rounded px-1 py-2 leading-snug",
              selectable && "cursor-pointer hover:bg-info/10",
            )}
          >
            {/* ⚠️ THE DOCUMENT'S OWN POSITION, and ONLY that — never an
                ordinal fallback. Its job is to let the reader find this row IN
                THEIR DOCUMENT, so a number we invented would send them looking
                for a row that is not numbered. And the two cannot share a
                column: measured on a real read, 113 of 145 rows carry a
                position, so a mixed document would print our count beside the
                document's on adjacent lines with nothing to tell them apart.
                A row without one renders blank and the column keeps its width,
                so the titles stay aligned either way. (A document that numbers
                NOTHING arrives already labelled `R-n` by the gather — Step 1142,
                extraction's call on the STORED item, never this column's.)
                ⚠️ Step 1152 — a FIXED width, clipped with an ellipsis past four
                characters and carried whole in the tooltip: see `PositionCell`
                for the row that reversed the old "may grow, never clipped". */}
            <PositionCell position={it.position} />
            {/* ⚠️ STACKED, not inline (Step 1063, operator's draft). The name
                takes the first line and the code and quantity sit UNDER it,
                indented — so a scan down the list reads one column of product
                names rather than three fields competing on one line.
                `min-w-0` is what lets a long name WRAP instead of forcing the
                row wider than the card; without it a flex item refuses to
                shrink below its content. */}
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block",
                  selectable && !isKept(i)
                    ? "text-muted-foreground line-through"
                    : "text-foreground",
                )}
              >
                {it.name}
              </span>
              {/* ⚠️ NO SIZE CLASS ON ANY OF THE THREE. Name, code and quantity
                  differ in COLOUR and POSITION only, and all inherit the
                  caller's scale — a size class here re-creates the
                  heading-with-footnotes look the stack exists to replace.
                  ⚠️ And no `·` any more: a separator between two things on
                  the same line means nothing once they are on different ones. */}
              {it.code ? <span className="block pl-6 text-muted-foreground">{it.code}</span> : null}
              {/* ⚠️ THE UNIT IS PART OF THE QUANTITY (Step 1071). `×1` where the
                  document says `1 kompl.` is not orderable — Step 862's own
                  note: "120 metres of insulation and 120 pieces are different
                  purchases". `formatQuantity` owns BOTH the wording and whether
                  this renders at all, so the card cannot say one thing and gate
                  on another. */}
              {quantityLabels[i] ? (
                <span className="block pl-6 text-muted-foreground">{quantityLabels[i]}</span>
              ) : null}
              {/* ⚠️ THE ROW'S OWN DETAIL, and without it this list cannot do its
                  job. Measured on the operator's two real documents, 145 items
                  share only 70 names: sixteen rows read "Akmens vatos
                  vamzdiniai kevalai" and differ ONLY here (diameter, temperature
                  band, wall thickness). Retrieval has used `specs` since Step
                  820 and the export has carried it since Step 1064, so the
                  MATCH could tell those rows apart and the human being asked to
                  approve them could not.

                  ⚠️ CLAMPED TO TWO LINES, and the number is measured rather
                  than picked. Across both documents the point where two
                  same-named rows first DIVERGE is char 2 at p50, 28-55 at p90
                  and 128 at worst, while `specs` itself reaches 255-461 chars —
                  so the distinguishing part is near the front and a clamp costs
                  nothing that matters. Two lines MEASURES 186 chars in this
                  card (696px at 15px), comfortably past that worst case;
                  `title` carries the rest, and Step 1064's export carries all
                  of it.

                  ⚠️ NO `block` BESIDE `line-clamp-2`. The utility DECLARES a
                  `display`, and tailwind-merge does not treat the two as
                  conflicting — so both would survive `cn()` and emitted order
                  alone would decide which wins. The Step-1002 lesson from the
                  other side. (What Chrome COMPUTES for a clamped element is
                  `flow-root`, not the declared `-webkit-box`: its modern
                  line-clamp implementation. Assert the OUTCOME — a capped
                  height — never that value.)

                  ⚠️ AND NO SIZE CLASS, so Step 1061's rule is intact: every
                  line of this row differs in COLOUR and POSITION only. */}
              {it.specs ? (
                <span className="line-clamp-2 pl-6 text-muted-foreground" title={it.specs}>
                  {it.specs}
                </span>
              ) : null}
            </span>
            {selectable ? (
              // ⚠️ THE SHARED PRIMITIVE, not a third spelling of a checkbox.
              // This was a raw 14px `accent-info` input — smaller than the
              // 20px every other checkbox in the app renders, and skipping
              // the contrast Step 988 MEASURED for the checked fill and the
              // unchecked border. `mt-px` sits it on the first line's cap.
              //
              // ⚠️ ON THE RIGHT, and it is the LAST child rather than a
              // `ml-auto` one — the title block already carries `flex-1`, so
              // it takes the slack and the box lands on the right edge on its
              // own. Adding `ml-auto` as well would be a second thing to keep
              // in step with the first.
              <Checkbox
                checked={isKept(i)}
                onChange={() => onToggle?.(canonical(i))}
                className="mt-px shrink-0"
              />
            ) : null}
          </Row>
        </li>
      ))}
    </ul>
  );
}

/**
 * Step 1145 — the card's HEADER ROW, shared by the Extract and Match stages:
 * the summary line on the left, a check/uncheck-ALL box on the right, a rule
 * beneath (the operator's draft).
 *
 * ⚠️ THE BOX SITS IN THE ROWS' OWN COLUMN. The row geometry is `px-1` with the
 * checkbox as the LAST flex child (Steps 1074 / 1094), so this row wears the
 * same `px-1` and puts its box last too — the header's box lands on the same
 * right edge as every row's, which is what makes it read as "all of these".
 * `items-start` + `mt-px`, as the rows have it, so a wrapping summary keeps
 * the box on its first line.
 *
 * ⚠️ `pt-1 pb-2` — 4px above the summary (the +8px of Step 1145, measured
 * against the row rhythm: the rows are `py-2`, and a header at `py-0` sat
 * flush against the card's own padding) and 8px below it (Step 1146, the
 * operator's ask: the summary sat too close to the rule). The rule is
 * `border-b` on THIS row, not `border-t` on the list: the list
 * draws rules BETWEEN rows only (`[&>li+li]`, the Step-1061 scannability
 * rule) and must keep doing so, so the header/list boundary is the header's.
 *
 * ⚠️ CHECKED MEANS ALL, and a click flips to the other extreme: every line
 * kept when any is dropped, none when all are. A half-ticked list shows the
 * box unchecked — the count beside it ("Pricing 48") already says how many —
 * rather than a third, indeterminate glyph the primitive does not draw.
 */
export function CardHeader({
  children,
  allChecked,
  onToggleAll,
  label,
}: {
  children: React.ReactNode;
  /** Present only while the list is selectable; absent hides the box. */
  allChecked?: boolean;
  onToggleAll?: (on: boolean) => void;
  /** What the box ticks — the accessible name (`Tick every line`). */
  label?: string;
}) {
  const selectable = allChecked !== undefined && onToggleAll !== undefined;
  return (
    <div className="flex items-start gap-2.5 border-b border-hairline px-1 pt-1 pb-2">
      <div className="min-w-0 flex-1">{children}</div>
      {selectable ? (
        <Checkbox
          checked={allChecked}
          onChange={() => onToggleAll(!allChecked)}
          aria-label={
            allChecked ? `Untick every ${label ?? "line"}` : `Tick every ${label ?? "line"}`
          }
          title={allChecked ? "Untick all" : "Tick all"}
          className="mt-px shrink-0"
          data-card-header-checkbox=""
        />
      ) : null}
    </div>
  );
}

/**
 * Step 1033 — what the read actually covered, under the confirm list.
 *
 * ⚠️ Every field here was already on the document and read by nobody on this
 * surface. `MoiRunCard` has rendered the same three since Steps 822/898; the
 * PRICING card announced "Found 25 lines." on a 158-line tender with total
 * confidence. The wording mirrors MOI's deliberately — two cards describing one
 * gather in two vocabularies is its own kind of wrong.
 */
export function CoverageNote({
  read,
  coverage,
  capped,
  itemsSizeCut,
  notListed,
  selectedCount,
}: {
  read: number;
  coverage: PricingCoverage;
  capped: boolean;
  /**
   * Step 1071 — lines the extract dropped because the stored run would not fit
   * a Firestore document.
   *
   * ⚠️ THE SAME FOUR INPUTS THE EXPORT TAKES. `coverageNotes` is
   * `(read, coverage, capped, itemsSizeCut)`, so the card and the file are
   * built from one set of facts — the standing rule that stops a spreadsheet
   * and the screen describing one gather in two vocabularies.
   */
  itemsSizeCut?: number;
  /**
   * Step 1081 — lines READ but not listed, because they carry no quantity.
   *
   * ⚠️ THE CARD CANNOT STAY SILENT ABOUT THIS. `read` is what the gather
   * returned, so hiding rows makes the count and the list disagree by exactly
   * this number — and a reader who counts the rows would have no way to
   * explain the gap. Naming it is what keeps the note true.
   */
  notListed?: number;
  /** Present only while the list is selectable. */
  selectedCount?: number;
}) {
  const gaps = coverage.missingPositions;
  return (
    // Chat's own body scale (15px), so the card reads at one size throughout.
    <p className="text-subhead text-foreground">
      Found <span className="font-semibold">{read}</span>
      {/* ⚠️ `total_count` is what the file held BEFORE the cap, so it is the
          only number that can say "of". Reading it is the whole fix: the old
          capped line said "(showing the first N)" where N was the count it had
          just printed — a sentence that cannot be false and says nothing. */}
      {coverage.totalCount > read ? <> of {coverage.totalCount}</> : null}{" "}
      {read === 1 && coverage.totalCount <= read ? "line" : "lines"}
      {capped && coverage.totalCount <= read ? (
        <span className="text-muted-foreground"> (capped)</span>
      ) : null}
      {gaps.length > 0 ? (
        <span
          className="text-amber-600 dark:text-amber-400"
          title="Your document numbers these rows, but they are not in the list. They may be absent from the file, or missed while reading it."
        >
          {" "}
          (not found: {gaps.slice(0, 6).join(", ")}
          {gaps.length > 6 ? "…" : ""})
        </span>
      ) : null}
      {/* ⚠️ Suppressed when it repeats the "of N" above it. `total_count` (what
          the gather counted) and `shortfall.expected` (what the document
          declares) are different measurements and usually agree — so on the
          common path the clause restated the same two numbers a few words
          later. It renders only when it says something the count did not. */}
      {coverage.shortfall && coverage.shortfall.expected !== coverage.totalCount ? (
        <span
          className="text-amber-600 dark:text-amber-400"
          title="Your document appears to declare more purchasable rows than were read. Re-running usually picks up the rest; if it does not, the file may need splitting."
        >
          {" "}
          — your document looks like it has about {coverage.shortfall.expected}, so{" "}
          {coverage.shortfall.missing} may be missing
        </span>
      ) : null}
      {/* ⚠️ Audit F5 — the gather stopped on its own budget, so every number
          above describes only the part of the document it reached. This is the
          one clause that must render even when the others are silent: on a
          stopped run "Found 40 of 40 lines" is true of what was read and false
          about the file, and nothing else on this card would say so. */}
      {coverage.stoppedEarly ? (
        <span
          className="text-amber-600 dark:text-amber-400"
          title="Reading stopped at a time limit before the whole file was covered, so the counts above describe only the part that was read. Split the file into smaller uploads to cover the rest."
        >
          {" "}
          — reading stopped after {coverage.stoppedEarly.read} of {coverage.stoppedEarly.total}{" "}
          {coverage.stoppedEarly.unit}
          {coverage.stoppedEarly.total === 1 ? "" : "s"}, so the rest of the file was not read
        </span>
      ) : null}
      {/* ⚠️ Step 1071 — a BYTE cut, and it had reached the export's NOTES block
          and nothing on screen. Without it the card renders "Found 294 of 400
          lines" with no explanation at all: `capped` is false (the file was
          under the line ceiling), so no other clause fires and the reader is
          left to assume the document simply had fewer rows than it does.

          ⚠️ NOT `capped`, and kept a separate clause for that reason. That one
          means the FILE held more lines than we read; this means we READ them
          and could not store them. Both can be true at once, so they compose
          rather than replace each other. The recourse happens to be the same —
          fewer lines per upload is fewer bytes per document — which is why the
          tooltip says it plainly instead of inventing a distinction. */}
      {itemsSizeCut && itemsSizeCut > 0 ? (
        <span
          className="text-amber-600 dark:text-amber-400"
          title="These lines were read from your document but were too large to store with the run, so they are not in this list, will not be priced, and are not in the export. Split the file into smaller uploads to keep them all."
        >
          {" "}
          — {itemsSizeCut} more {itemsSizeCut === 1 ? "line was" : "lines were"} read but too large
          to store, so {itemsSizeCut === 1 ? "it is" : "they are"} not in this list
        </span>
      ) : null}
      {/* ⚠️ Step 1081 — the rows the card no longer lists. `read` is what the
          gather returned, so hiding them makes the count and the list disagree
          by exactly this number; without this clause the reader sees "Found
          125 lines" over a 110-row list and nothing explains the gap.

          ⚠️ MUTED, not amber, and the Step-750 rule is why. Amber means content
          is LOST: these lines are still in the document, still in the run, and
          still in the export a click below — and most documents have a few, so
          colouring the normal path amber is exactly what destroys the warnings
          that do mean loss. The tooltip names the export, because that is the
          recourse when a real order line lost its quantity to a misread. */}
      {notListed && notListed > 0 ? (
        <span
          className="text-muted-foreground"
          title="These lines carry no quantity, so they read as general information rather than something to buy. They are not listed here and will not be priced. The XLS export below still lists every line that was read."
        >
          {" "}
          — {notListed} {notListed === 1 ? "line has" : "lines have"} no quantity and{" "}
          {notListed === 1 ? "is" : "are"} not listed
        </span>
      ) : null}
      .
      {selectedCount !== undefined && selectedCount !== read ? (
        <span className="text-muted-foreground">
          {" "}
          Pricing <span className="font-semibold text-foreground">{selectedCount}</span>.
        </span>
      ) : null}
    </p>
  );
}

/**
 * Step 1033 — what a no-match row says, and how loudly.
 *
 * ⚠️ ONE definition for both views. The table and the fallback list each had
 * their own hardcoded "Not found", which is exactly how two renderings of one
 * fact drift apart.
 *
 * Only `not_searched` is amber, and the asymmetry is the point: it is the one
 * the reader can act on, and the one that is OURS rather than their supplier's.
 * Colouring a genuine no-match would spend the signal on the common case.
 */
function NoMatchCell({ item, compact }: { item: IplResultItem; compact?: boolean }) {
  const kind = noMatchKind(item);
  const amber = kind === "not_searched";
  return (
    <span
      className={cn(
        amber ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
        compact ? "" : "flex items-baseline gap-2 text-footnote",
      )}
      title={NO_MATCH_TITLE[kind]}
    >
      {compact ? null : <span className="shrink-0">→</span>}
      <span>{compact ? NO_MATCH_SHORT[kind] : NO_MATCH_LONG[kind]}</span>
    </span>
  );
}

const NO_MATCH_SHORT: Record<IplNoMatchKind, string> = {
  not_searched: "Not searched",
  not_a_product: "Not a product",
  not_found: "Not found",
};

const NO_MATCH_LONG: Record<IplNoMatchKind, string> = {
  not_searched: "Not searched — retrieval failed",
  not_a_product: "Not a product — skipped",
  not_found: "Not found in your catalogues",
};

const NO_MATCH_TITLE: Record<IplNoMatchKind, string> = {
  not_searched:
    "Retrieval returned nothing for this line, even after a retry — that is a search failure, not evidence the product is unavailable. Run the pricing again.",
  not_a_product:
    "This line reads as a bulk material or a labour item rather than a product, so it was never searched.",
  not_found:
    "Your documents were searched and nothing in them matched this line. (Runs from before this was recorded also show here.)",
};

/** The completed result. With prices it is a table, one column per price list. */
export function IplResultView({
  result,
  selected,
  onToggleOption,
  onToggleAll,
  className,
  listClassName,
  footer,
  total = true,
}: {
  result: IplResult;
  /** item index -> the option indices ticked on that line. */
  selected: ReadonlyMap<number, ReadonlySet<number>>;
  onToggleOption: (itemIndex: number, optionIndex: number) => void;
  /**
   * Step 1145 — the header's check/uncheck-ALL: `true` ticks every priced
   * option on every line (the default selection), `false` clears the lot.
   * PRICING passes the hook's `setAll`; the retired chat card passes nothing
   * and gets no box.
   */
  onToggleAll?: (on: boolean) => void;
  /**
   * Step 1104 — rendered after the list, inside the card: PRICING puts the
   * discount ask and the "Next >" to the Price step here, where the Extract
   * step's own Next sits. The retired chat card passes nothing.
   */
  footer?: React.ReactNode;
  /**
   * Step 1106 — the Total row under the list. PRICING's Match step turns it
   * OFF (operator's call): the total belongs to the Price step, which shows
   * it list-beside-net with the same guards, and the discount ask takes the
   * row's place. The retired chat card keeps it — it has no Price step.
   */
  total?: boolean;
  /**
   * The caller's own box.
   *
   * ⚠️ THIS VIEW OWNS NO CHROME, for the reason `ItemList` records one
   * screen earlier: PRICING renders it INSIDE the chat answer card, and
   * `IplRunCard` — the RETIRED chat agent (Step 974) — renders it inside a run
   * card, where a second card would nest. Baking either in forces the other to
   * be wrong, so the box moved to the CALLERS.
   */
  className?: string;
  /**
   * The list's own box, when the caller wants one.
   *
   * ⚠️ DEFAULT IS NONE, AND THAT IS THE POINT. The list used to carry a
   * hardcoded `max-h-96 overflow-y-auto` inset panel, so a priced 158-line
   * tender was a 24rem peephole onto the one thing the reader has to check
   * — the same failure Step 1061 fixed on the confirm list, still live one
   * stage later. PRICING passes nothing (the page already scrolls); the retired
   * card passes its own former panel, so it is unchanged.
   */
  listClassName?: string;
}) {
  const s = summarise(result);
  /* ⚠️ THE LIST SPLITS ON WHETHER A LINE HAS ANYTHING QUOTABLE, and the
     unpriced half is COLLAPSED rather than dropped: telling a buyer their
     supplier does not stock a line we never SEARCHED is a claim we have no
     evidence for (Step 1033 measured ten such lines on one real tender). The
     canonical index travels with each entry, because the selection is stored
     under it and this list is filtered. */
  const priceable: Array<{ item: IplResultItem; options: IplOption[]; index: number }> = [];
  const unpriced: IplResultItem[] = [];
  for (const [index, item] of result.items.entries()) {
    const options = pricedOptionsOf(item, IPL_MAX_MATCHES);
    if (options.length > 0) priceable.push({ item, options, index });
    else unpriced.push(item);
  }
  const selectionSummary = summariseSelection(result, selected, IPL_MAX_MATCHES);
  // Step 735 — "Priced" means lines that CONTRIBUTE to a total: lines carrying
  // a ticked, priced option. ⚠️ Step 1118 — there is no confidence floor any
  // more, so every ticked priced line counts; this is simply the lines with a
  // ticked price.
  // Step 1033 — counted, not inferred: `noMatchReason` says which no-match
  // lines were a search FAILURE. Absent on runs from before it was carried, and
  // those correctly count zero rather than guessing.
  const notSearched = countNotSearched(result);
  /* Step 735 - "Priced" means lines that CONTRIBUTE to a total: the lines
     carrying a ticked, priced option — the same figure the footer reports,
     from the same function, so the header and the total cannot disagree. */
  const pricedCount = selectionSummary.priced;
  // Step 1145 — "all" is every priced option on every priceable line ticked:
  // the default selection, and what the header box restores.
  const allTicked = priceable.every(({ index, options }) =>
    options.every((o) => selected.get(index)?.has(o.index) ?? false),
  );
  // ⚠️ Step 1149 — ONE locale for every figure on the card, the RESULT's: the
  // same `documentLocale(result.lang)` the export prints in, never the machine
  // rendering. This card is server-rendered; a locale the server reads off its
  // own OS (en-US on Vercel) put `6,283.47` in the HTML under a browser that
  // hydrated `6 283,47` — the React #418 mismatch that also wiped App Check's
  // reCAPTCHA container (see `formatMoney`).
  const locale = documentLocale(result.lang);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Chat's own body scale, like `CoverageNote` on the confirm card: this
          line is the same kind of thing one stage later — what the run covered
          — so the card reads at one size throughout rather than opening on a
          12px summary above 15px rows. Step 1145 — inside the shared header
          row, with the tick-all box on the right when the caller can act on it. */}
      <CardHeader
        allChecked={onToggleAll && priceable.length > 0 ? allTicked : undefined}
        onToggleAll={onToggleAll}
        label="price"
      >
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-subhead">
          <Stat label="Lines" value={s.total} />
          {/* ⚠️ Step 1118 — "Identified" is now every line with a match: the
            confidence tier (confident / low) is gone, so a matched line is
            matched. With `Priced` a subset and `not searched` a subset of
            `Not found`, these are counts to read, not a strict partition. */}
          <Stat label="Identified" value={s.matched} accent />
          <Stat label="Not found" value={s.none} />
          {priceable.length > 0 ? (
            <Stat
              label="Priced"
              value={pricedCount}
              accent
              title="Lines with a ticked price that counts towards a total."
            />
          ) : null}
          {notSearched > 0 ? (
            /* Step 1033 — MOI has had this badge since Step 847 and PRICING had
             nothing: a line retrieval never managed to search was counted into
             "Not found" and rendered like a product the corpus lacks. Amber,
             because unlike a genuine no-match this one is ours to fix. */
            <span
              className="text-amber-600 dark:text-amber-400"
              title="Retrieval returned nothing for these lines, even after a retry — that is a search failure, not evidence the products are unavailable. Run the pricing again."
            >
              {notSearched} not searched
            </span>
          ) : null}
        </p>
      </CardHeader>

      {/* A rule BETWEEN lines, never a box around each — `ItemList`'s rule,
          for `ItemList`'s reason: the list has to stay scannable at 100+ lines.
          ⚠️ NOT `divide-y`, which emits NOTHING in this project (measured
          against the built CSS at Step 1061) and renders as no rule at all. */}
      <ul
        className={cn("flex flex-col [&>li+li]:border-t [&>li+li]:border-hairline", listClassName)}
      >
        {priceable.map(({ item, options, index }) => (
          // Audit F9 - `name|code` is NOT unique in a bill of quantities (three
          // keys collided on one real 15-line tender), and `position` is absent
          // on documents that do not number their rows. The CANONICAL index is
          // the only key unique by construction, and it is the same key the
          // selection is stored under.
          <IplPricedLine
            key={index}
            item={item}
            options={options}
            ticked={selected.get(index) ?? EMPTY_SET}
            onToggle={(optionIndex) => onToggleOption(index, optionIndex)}
            locale={locale}
          />
        ))}
        <UnpricedSummary items={unpriced} />
      </ul>

      {total ? (
        <div className="flex items-start justify-between gap-3 border-hairline border-t pt-2 text-subhead">
          <span className="text-muted-foreground">Total</span>
          <SelectionTotal summary={selectionSummary} locale={locale} />
        </div>
      ) : null}
      {footer}
    </div>
  );
}

/** A stable empty set, so an unticked line does not remount its options. */
const EMPTY_SET: ReadonlySet<number> = new Set();

/**
 * One OPTION - a matched product the user can tick.
 *
 * ⚠️ The row the operator drew: score, code, brand, price. Every part is
 * optional except the score, because a run from before Step 1085 carries no
 * brand and a match can legitimately have no code - so each renders only when
 * it has something to say rather than printing an empty separator.
 */
function IplOptionRow({
  option,
  checked,
  onToggle,
  locale,
}: {
  option: IplOption;
  checked: boolean;
  onToggle: () => void;
  /** The result's locale (Step 1149) — the card derives it once. */
  locale: string;
}) {
  const price = option.price;
  return (
    // The control IS nested — `Checkbox` renders a real `<input type="checkbox">`
    // (Step 1061 swapped the raw input for it) — but biome cannot see through a
    // component boundary. `ItemList` escapes the same rule only because its tag
    // is a variable. Step 1060: the directive must be the LAST comment line.
    // ⚠️ `py-1` (4px each side), operator's ask at Step 1097. It was `py-0.5` —
    // 2px inside the row against the 12px the column now puts BETWEEN rows, so
    // the hover background hugged the text. The padding is what the pointer
    // lands on, and it is the half a row gap cannot give.
    // ⚠️ Step 1157 — TWO LINES, ONE LABEL: the fields and the checkbox keep their
    // row (the checkbox stays level with the FIELDS, as the operator drew it),
    // and the price list's own name for the article hangs under them. Both
    // lines are inside the label, so the hover background and the click cover
    // the whole candidate, not just its first line.
    // biome-ignore lint/a11y/noLabelWithoutControl: the Checkbox renders the input
    <label
      className="flex cursor-pointer flex-col gap-1 rounded py-1 pl-6 hover:bg-info/10"
      /* ⚠️ Step 1127 — WHICH PART OF A SET THIS ROW ANSWERS IS A TOOLTIP, NOT
         A FIELD. The row is `score · code · brand · price` (Step 1094, the
         operator's drawing); Step 1126 had put the part in front of it, and
         on the live line that read `RAS-10WHNPE: 95% · RAS-10WHNPE · …` — the
         same code twice, and a fifth field on a row that has four. The matched
         code already says which piece a row is; the sheet's Status column
         still says `part: …` in words; the hover keeps it reachable here. */
      title={option.match.part ? `Part of the set: ${option.match.part}` : undefined}
    >
      <span className="flex items-center gap-2">
        {/* ⚠️ NO SIZE CLASS. The scale is the line's, inherited — the Step-1061
          rule that keeps a row reading as one line rather than a heading with
          footnotes. */}
        {/* ⚠️ THE ROW SCROLLS SIDEWAYS RATHER THAN SQUEEZING (operator's ask,
          from the mobile view). At 375px the position column, the `pl-6` indent
          and the checkbox leave ~230px for `85% · HIT-RAS-10WHNPE · Hitachi ·
          6 283,471 EUR`, which does not fit in any arrangement — so the choice
          is between hiding part of it and letting the reader reach it. Every
          field is `shrink-0` INSIDE this scroller, so nothing is clipped; the
          checkbox is the scroller's SIBLING, so it stays pinned and reachable
          however far the text is scrolled.

          ⚠️ `no-scrollbar`, and the trade was reconsidered rather than
          assumed. A bare `overflow-x-auto` costs NOTHING on mobile (overlay
          scrollbars) but ~15px of classic scrollbar per row on a narrow desktop
          window — on EVERY overflowing row at once, which in a dense list reads
          as broken. The app already hides scrollbars on its own scrolling
          regions (`PricingView`'s `no-scrollbar flex-1 overflow-y-auto`), so
          this joins a convention rather than inventing one.

          ⚠️ THE HAZARD THIS LEAVES, MEASURED rather than guessed — look at
          screenshots/pricing-stage2-375.png. PRICE IS THE LAST FIELD, so at
          375px it is not merely cut: it is ENTIRELY OFF-SCREEN on every option
          row (199px visible of a 357px row), and each row scrolls
          independently. The default mobile view therefore shows a checkbox
          beside a figure the reader cannot see at all. Pinning the price outside the scroller
          (as the checkbox is pinned) would remove that, at the cost of
          restructuring the row the operator drew. Not done unasked. */}
        {/* ⚠️ Step 1124 — AN UNTICKED CANDIDATE IS STRUCK THROUGH, the way the
          confirm step strikes an unticked line (operator's ask: "as we do in
          the 1st stage"). ONE class on the scroller: `text-decoration` set on
          a flex container propagates to its in-flow children, so every field
          — score, code, brand AND the price — reads as crossed out, which is
          what unticking means here: this candidate, and its money, are out of
          the total. Plain `line-through`, the confirm step's own spelling, not
          the Price step's softened `decoration-muted-foreground/60` (that one
          strikes a list price NEXT TO a net figure; this strikes a whole row
          with nothing beside it). The strike flips with the tick since
          `checked` is the same boolean the checkbox reads.

          ⚠️ Step 1125 — `text-muted-foreground` ON THE CONTAINER TOO, and it
          is load-bearing even though every field is already muted. A
          decoration is drawn in the colour of the element that DECLARES it —
          `text-decoration-color: currentcolor` resolves against the decorating
          box, not the text it runs through. This scroller sets no colour of
          its own, so it inherited the dark foreground and drew a BLACK line
          through grey text; the operator saw it at once ("1st stage uses grey
          line ... this same color should be in the 2nd stage"). Stage 1's
          pair is `text-muted-foreground line-through` on ONE element, so its
          line is grey by construction; the same two classes here make this
          scroller's currentColor the same grey, and the line follows. The
          driver reads the scroller's computed `textDecorationColor` against
          a field's `color` — equal is the whole claim. */}
        <span
          className={cn(
            "flex min-w-0 flex-1 items-baseline gap-2 overflow-x-auto no-scrollbar",
            !checked && "text-muted-foreground line-through",
          )}
        >
          {/* ⚠️ Step 1123 — THE SCORE IS BACK (operator's call, reversing the
            display half of Step 1118 only): the judge's % leads the row again,
            one colour for every score (Step 1094). What did NOT come back is
            the floor — a match is a match, every ticked price is in the total
            whatever this number says (Step 1118 stands). The score is EVIDENCE
            for the reader to judge the row by, and decides nothing about money.
            `code`/`brand`/`price` each still bring their own `Sep`; the percent
            is the anchor with no leading dot, as it was before 1118. */}
          {/* ⚠️ Step 1126 put the PART in front of the score on a composite line
            (`RWM10.0N1E: 40% · HIT-RWM-10.0N3E · …`); Step 1127 took it off
            again — the operator's row pattern has four fields, and the part
            rode ahead of it as a fifth. A part's row now renders exactly like
            any other option row; what still marks it as half of a set is the
            `title` on the label above, the sheet's `part: …` Status, and the
            "not found" line below when the other half is missing. */}
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {option.match.percent}%
          </span>
          <Sep />
          <span className="shrink-0 text-muted-foreground">
            {option.match.code || option.match.name}
          </span>
          {option.match.brand ? (
            <>
              <Sep />
              {/* ⚠️ NO LONGER TRUNCATED, and the reversal is the point. The brand
                was "the one field allowed to lose the squeeze — the least
                actionable of the four" while the row had to fit and something
                had to give. Inside a scroller nothing has to give, and
                `truncate` would actively defeat it: the text would be CLIPPED
                at the ellipsis instead of scrolling into view. */}
              <span className="shrink-0 text-muted-foreground">{option.match.brand}</span>
            </>
          ) : null}
          {price ? (
            <>
              <Sep />
              <span
                className="shrink-0 text-muted-foreground tabular-nums"
                /* ⚠️ NEVER A BARE NUMBER (Step 726). A price list routinely carries
               net AND gross, so the column the figure came from is what makes it
               unambiguous - kept on the row rather than dropped for tidiness. */
                /* Step 1153 — and what the PRICE LIST calls the article, when its
                 row names it: the supplier's words, beside the supplier's file.
                 A tooltip, not a field (the Step-1127 rule for the row). */
                title={`${price.label || "price"}${price.unit ? ` (${price.unit})` : ""} - ${price.sourceFile}${price.itemName ? `: ${price.itemName}` : ""}`}
              >
                {/* Step 1101 — two decimals, whatever the list carried; the
                  same formatter as the total, so the two cannot disagree. */}
                {formatMoney(price.value, locale)} {price.currency}
              </span>
            </>
          ) : null}
          {/* ⚠️ THE `check` PILL IS GONE (operator's call, Step 1094), and one
            thing it took with it is worth stating: it was the only leaf on this
            row at a size of its own (`text-[10px]` against the line's inherited
            scale), so the Step-1061 "a row reads at ONE size" rule now holds on
            a low-scoring row too, not just on the confident ones the driver
            happened to measure. */}
        </span>
        <Checkbox checked={checked} onChange={onToggle} />
      </span>
      {/* `pr-7` = the checkbox's `w-5` + the row's `gap-2`: the ellipsis ends
          where the fields do, not under the checkbox. */}
      {price?.itemName ? (
        <OptionItemName name={price.itemName} struck={!checked} className="pr-7" />
      ) : null}
    </label>
  );
}

/**
 * The dot between an option's fields (the operator's draft).
 *
 * ⚠️ EACH OPTIONAL FIELD BRINGS ITS OWN, rather than the row joining a list
 * of the parts that happen to be present. The score is the one thing every
 * option has — a run from before Step 1085 carries no brand, and a match can
 * legitimately have no code — so every field after it renders its own leading
 * dot, and the row can never open or close on a separator with nothing beside
 * it.
 *
 * ⚠️ `aria-hidden`: it is punctuation between values. A screen reader
 * announcing "middle dot" three times per option is noise, not structure.
 */
function Sep() {
  return (
    <span aria-hidden className="shrink-0 select-none text-muted-foreground/40">
      &middot;
    </span>
  );
}

/**
 * Step 1157 — the price list's OWN name for the article, under the option's
 * fields, on the Match card and the Price step (operator: "I want to have
 * original product name below the current code, brand, price line. Use 12px
 * text for product name, only one line (ellipsis if text does not fit").
 *
 * ⚠️ `IplPrice.itemName` ONLY — the Step-1153 rule, unchanged: optional, never
 * invented, never the `Model` name copied across (that is the IDENTITY's name,
 * a datasheet's words; this is the supplier's, from the row the price came
 * from). A run from before Step 1153, a sheet-only price and a row with no name
 * cell have none, and then there is no line at all rather than an empty one.
 *
 * ⚠️ NOT A FIFTH FIELD: the row keeps `score · code · brand · price` (Step 1127);
 * this is a line of its own under it, so the four-field rule still holds.
 *
 * `text-footnote` (12px, the scale's token — registered with `cn`'s merger, so
 * it does not fight the colour class), the operator's draft weight, ONE line
 * cut with an ellipsis and whole in its tooltip. The caller places it
 * (`className`: the Match row reserves its checkbox column, the Price row
 * indents to its code). `struck` follows the tick (Step 1124): an unticked
 * candidate is out of the total, name and all.
 */
export function OptionItemName({
  name,
  struck = false,
  className,
}: {
  name: string;
  struck?: boolean;
  className?: string;
}) {
  return (
    <span
      data-option-item-name=""
      className={cn(
        "truncate font-semibold text-footnote text-muted-foreground",
        className,
        struck && "line-through",
      )}
      title={name}
    >
      {name}
    </span>
  );
}

/** One priced line: the document's own row, then every option under it. */
function IplPricedLine({
  item,
  options,
  ticked,
  onToggle,
  locale,
}: {
  item: IplResultItem;
  options: IplOption[];
  ticked: ReadonlySet<number>;
  onToggle: (optionIndex: number) => void;
  /** The result's locale (Step 1149) — the card derives it once. */
  locale: string;
}) {
  const qtyLabel = formatQuantity(item.source);
  return (
    // ⚠️ THE CONFIRM CARD'S ROW GEOMETRY, class for class (Steps 1061/1063/1074):
    // the same `PositionCell` (Steps 1152/1154: `w-10`, CUT past four characters),
    // the same `gap-2.5`, the same `px-1 py-2 leading-snug`. These two stages
    // are the SAME lines of the same document read twice, so a reader who
    // ticked a row on the confirm card has to find it here without re-learning
    // where its position number sits — the column was 3rem on one stage and
    // 2.5rem on the other.
    <li className="flex items-start gap-2.5 px-1 py-2 text-subhead leading-snug">
      {/* The document's OWN position and only that — never an ordinal fallback,
          for the reason `ItemList` records: a number we invented sends the
          reader looking for a row their document does not number. */}
      <PositionCell position={item.source.position} />
      {/* ⚠️ THE OPTIONS LIVE INSIDE THE NAME COLUMN, not beside the position.
          That is what puts their `pl-6` indent on the axis stage 1 already uses
          for a row's code / quantity / specs — so on BOTH stages a line's
          sub-rows hang under its NAME, instead of under the name on one stage
          and the card's edge on the other. */}
      {/* ⚠️ THE CANDIDATES ARE SPACED (operator's call, Step 1094). They used
          to stack flush — `py-0.5` and nothing between — so at three options a
          line read as one block of text rather than three things to choose
          between, and the hover background of one row touched the next. The gap
          is on the COLUMN rather than between siblings, so it also separates
          the line's own name from the first option beneath it: the candidates
          then read as a group hanging off the name, which is what the indent
          already says. */}
      {/* ⚠️ `gap-3` (12px), operator's ask at Step 1097. Step 1094 shipped
          `gap-1` and recorded it as "a TRADE, not a default" — 4px paid several
          hundred times on a 158-line tender carrying up to three options a
          line. The operator has now seen that on a real run and wants the room;
          the trade is unchanged, the number is theirs. */}
      <span className="flex min-w-0 flex-1 flex-col gap-3">
        <span className="flex items-baseline gap-2">
          {/* Wraps rather than truncates, like the confirm card's name: a long
              line is the one you most need to read in full before ticking a
              price against it. */}
          <span className="min-w-0 flex-1 text-foreground">{item.source.name}</span>
          {/* ⚠️ THE UNIT IS PART OF THE QUANTITY (Step 1071) — `formatQuantity`
              owns both the wording and whether this renders at all. */}
          {qtyLabel ? <span className="shrink-0 text-muted-foreground">{qtyLabel}</span> : null}
        </span>
        {options.map((o) => (
          <IplOptionRow
            key={o.index}
            option={o}
            checked={ticked.has(o.index)}
            onToggle={() => onToggle(o.index)}
            locale={locale}
          />
        ))}
        {/* ⚠️ Step 1126 — A PART THAT MATCHED NOTHING IS SAID, NOT SKIPPED. On
            a set, the half that priced must not read as the whole: the
            operator's own line names `RWM10.0N1E`, the price list carries only
            the `N3E` variant, and until this the card showed the outdoor unit
            alone, priced, with nothing to say a piece was missing. Same indent
            as an option row (it belongs to the same set), no checkbox (there is
            nothing to tick), muted (it is a gap, not a product). */}
        {(item.partsNotFound ?? []).map((part) => (
          <span
            key={part}
            className="flex items-baseline gap-2 pl-6 text-muted-foreground/70"
            title="This part of the set matched nothing in your catalogues. The line's other part(s) are priced above; add this one by hand."
          >
            <span className="shrink-0">{part}:</span>
            <span className="shrink-0">not found</span>
          </span>
        ))}
      </span>
    </li>
  );
}

/**
 * The lines that produced no price, collapsed.
 *
 * ⚠️ COLLAPSED, NOT DELETED. The operator asked for "no price = no item in
 * the list", and dropping them silently would tell a buyer their supplier does
 * not stock a line we never SEARCHED - Step 1033 measured ten such lines on one
 * real tender, one of them a valve whose four sibling sizes matched at 85%.
 * "We could not look" is not "not stocked", and only one of them is ours to fix.
 * The EXPORT still lists every one of them, which is what makes hiding them
 * here acceptable at all (the Step-1081 rule).
 */
function UnpricedSummary({ items }: { items: IplResultItem[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const notSearched = items.filter((i) => noMatchKind(i) === "not_searched").length;
  return (
    // ⚠️ NO `border-t` OF ITS OWN any more: the list supplies the rule between
    // rows, so keeping this one would double it — and when this is the ONLY row
    // (a run where nothing priced) it would draw a rule under nothing.
    <li className="flex flex-col gap-1 px-1 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-left text-footnote text-muted-foreground hover:text-foreground"
      >
        <span>
          {items.length} {items.length === 1 ? "line" : "lines"} found no price
          {notSearched > 0 ? (
            <span className="text-amber-600 dark:text-amber-400">
              {" "}
              - {notSearched} {notSearched === 1 ? "was" : "were"} not searched
            </span>
          ) : null}
          . They are in the export.
        </span>
        <span aria-hidden>{open ? "\u25b4" : "\u25be"}</span>
      </button>
      {open ? (
        <ul className="flex flex-col gap-0.5 pl-2">
          {items.map((item, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: a static, unfiltered list
              key={i}
              className="flex items-baseline gap-2 text-footnote"
            >
              {/* Step 1152 — the same cell as every other stage, so a grouped
                  position clips here too instead of widening the summary. */}
              <PositionCell position={item.source.position} />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {item.source.name}
              </span>
              <NoMatchCell item={item} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The figure, and what it summed.
 *
 * ⚠️ `multiOptionLines` IS THE POINT. Options are additive by decision, so a
 * line may contribute twice - correct arithmetic that reads as one item unless
 * the total says so. Same rule as `assumedQty` before it: a convenient default
 * is fine, an invisible one is not.
 */
function SelectionTotal({ summary, locale }: { summary: IplSelectionSummary; locale: string }) {
  if (summary.totals.length === 0) {
    return <span className="text-muted-foreground">nothing selected</span>;
  }
  return (
    <span className="flex flex-col items-end gap-0.5">
      {summary.totals.map((t) => (
        <span key={t.currency || "?"} className="font-semibold tabular-nums">
          {formatMoney(t.sum, locale)} {t.currency}
        </span>
      ))}
      <span className="text-footnote text-muted-foreground">
        {summary.priced}/{summary.total} priced
        {summary.labels.length > 1 ? (
          <span
            className="text-amber-600 dark:text-amber-400"
            title={`This figure mixes columns that mean different things: ${summary.labels.join(", ")}.`}
          >
            {" "}
            &middot; mixed basis
          </span>
        ) : null}
        {summary.multiOptionLines > 0 ? (
          <span title="These lines contributed more than one price, so the figure counts them more than once. Untick the options you do not want to narrow it to a single-price quote.">
            {" "}
            &middot; {summary.multiOptionLines}{" "}
            {summary.multiOptionLines === 1 ? "line counts" : "lines count"} more than once
          </span>
        ) : null}
        {summary.assumedQty > 0 ? <span> &middot; {summary.assumedQty} qty assumed</span> : null}
        {/* ⚠️ Step 1118 — the "N below floor" clause is gone with the confidence
            floor: every priced, ticked line is in this figure now. */}
      </span>
    </span>
  );
}

/**
 * The per-option selection, owned by whichever surface renders the result.
 *
 * ⚠️ EPHEMERAL BY DESIGN, like the price-list toggles it replaces: a reload
 * starts from "everything ticked". Persisting it would mean deciding what
 * happens when a re-run returns different options, which is a bigger question
 * than this control is worth.
 *
 * ⚠️ RE-DERIVED WHEN THE RESULT CHANGES, never merged. A stale selection
 * carries option INDICES that a new result numbers differently, so merging
 * would tick an option the user never saw. `defaultSelection` skips lines with
 * nothing quotable, so an unpriced line can never be ticked into a total.
 */
export function useOptionSelection(result: IplResult | null) {
  const [selected, setSelected] = useState<Map<number, Set<number>>>(() =>
    result ? defaultSelection(result, IPL_MAX_MATCHES) : new Map(),
  );
  const lastResult = useRef<IplResult | null>(result);
  if (lastResult.current !== result) {
    lastResult.current = result;
    setSelected(result ? defaultSelection(result, IPL_MAX_MATCHES) : new Map());
  }

  function toggleOption(itemIndex: number, optionIndex: number) {
    setSelected((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(itemIndex) ?? []);
      if (set.has(optionIndex)) set.delete(optionIndex);
      else set.add(optionIndex);
      next.set(itemIndex, set);
      return next;
    });
  }

  /**
   * Step 1145 — the header's tick-all. `true` is the DEFAULT selection (every
   * priced option on every priceable line — the same function the first
   * render uses, so "all" cannot mean two things); `false` is nothing ticked.
   */
  function setAll(on: boolean) {
    setSelected(on && result ? defaultSelection(result, IPL_MAX_MATCHES) : new Map());
  }

  return { selected, toggleOption, setAll };
}

function Stat({
  label,
  value,
  accent,
  warn,
  title,
}: {
  label: string;
  value: number;
  accent?: boolean;
  warn?: boolean;
  title?: string;
}) {
  return (
    <span title={title}>
      <span className="text-muted-foreground">{label}: </span>
      <span
        className={cn(
          "font-semibold",
          accent
            ? "text-emerald-600 dark:text-emerald-400"
            : warn
              ? "text-amber-600 dark:text-amber-400"
              : "text-foreground",
        )}
      >
        {value}
      </span>
    </span>
  );
}

export function CancelButton({
  onClick,
  busy,
  label,
}: {
  onClick: () => void;
  busy: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {label}
    </button>
  );
}

export function Dismissable({
  text,
  onCancel,
  busy,
  destructive,
}: {
  text: string;
  onCancel: () => void;
  busy: boolean;
  destructive?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className={cn("text-sm", destructive ? "text-destructive" : "text-muted-foreground")}>
        {text}
      </p>
      <div className="flex justify-end">
        <CancelButton onClick={onCancel} busy={busy} label="Dismiss" />
      </div>
    </div>
  );
}
