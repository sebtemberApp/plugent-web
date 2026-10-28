"use client";

/**
 * Step 1105 — the ask at the foot of the Match step: the priced list is on
 * screen, the total under it, and then ONE line says that the price lists
 * carry discount references and asks who the discount is for. The user TYPES
 * a company name — "Vikjona" — and the Price step opens with every line priced
 * for that client.
 *
 * ⚠️ IT IS THE STAGE-3 PICKER MOVED FORWARD, NOT A SECOND WAY IN. Step 1104
 * put a Select on the Price step because its options ARE the evidence (a
 * client the table does not know cannot be chosen). Typing has no such fence,
 * so the name is RESOLVED by `matchClient` — exact, then a unique prefix or
 * word of at least three characters (Step 1117, audit L2) — and anything short
 * of one match RE-ASKS, listing what the table knows: an ambiguous "vik" shows
 * both Vikjonas, an unknown name shows every client, a lone "a" asks for more.
 * ⚠️ NEVER GUESSED. The wrong client is the wrong price on every line, and a
 * typed prefix that silently picked the first of two would be exactly that,
 * without a trace on screen.
 *
 * ⚠️ RESOLVED ON THE SERVER (Step 1117, audit L6). The page used to hold every
 * matrix and resolve the name itself; now `applyPricingDiscountClient` does
 * both in one round trip — resolve, and store the name — and hands back the
 * row the Price step prices with. The browser never sees the other clients'
 * terms.
 *
 * ⚠️ THE STORE IS WRITTEN BEFORE THE VIEW MOVES. `onApplied` fires only after
 * the server has stored the name, so a refused write (a lapsed session, a
 * deleted pricing) leaves the user on this stage with the error under the
 * box, never on a Price step showing a discount the sheet will not carry.
 *
 * ⚠️ AND THERE IS A WAY BACK TO LIST PRICES (Step 1117, audit L1). "change"
 * only ever offered ANOTHER client; a document once discounted could not be
 * quoted at list again. "list prices" beside it clears the stored name.
 *
 * ⚠️ NOTHING HERE IS SHOWN WHEN THE RUN CARRIES NO GROUP. A run from before
 * Step 1104, or price lists without the column, has nothing to apply — and the
 * table is not even fetched for it (`useDiscountTables`). "No discount
 * references" is silence, not a notice: a line explaining an absence on every
 * older run would train the user to skip the line that matters.
 */
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { DiscountTables } from "@/components/pricing/use-discount-tables";
import { iconButtonClass } from "@/components/ui/icon-button";
import { CLIENT_MATCH_MIN_CHARS, type DiscountClient } from "@/lib/agents/ipl/discount";
import {
  discountPromptOverlayFor,
  discountPromptText,
  type FunctionDescriptions,
} from "@/lib/functions/descriptions";
import { applyPricingDiscountClient, setPricingDiscountClient } from "@/lib/pricing/server";
import { cn } from "@/lib/utils";

/** The re-ask, when a typed name did not resolve to exactly one client. */
type Ask = { kind: "ambiguous" | "none" | "short"; typed: string; candidates: string[] };

/**
 * Step 1130 — a filled template with ONE placeholder rendered as a React node
 * (the client's name in bold inside "Prices are discounted for {name}"). The
 * template is split around the placeholder so the translation decides where
 * the name sits in the sentence; the code decides only how it looks.
 */
function withNode(template: string, placeholder: string, node: ReactNode): ReactNode {
  const token = `{${placeholder}}`;
  const at = template.indexOf(token);
  if (at === -1) return template;
  return (
    <>
      {template.slice(0, at)}
      {node}
      {template.slice(at + token.length)}
    </>
  );
}

export function DiscountPrompt({
  docId,
  groups,
  tables,
  discountClient,
  onApplied,
  onCleared,
  onReload,
  strings,
  className,
}: {
  docId: string;
  /** The run's own groups, read off the stored result — free, and the gate. */
  groups: string[];
  tables: DiscountTables;
  /** The stored choice, verbatim as the table spells it; null = list prices. */
  discountClient: string | null;
  /** The name was resolved AND stored: the Price step can open on its row. */
  onApplied: (name: string, client: DiscountClient, sourceFile: string) => void;
  /** Step 1117 (L1) — the stored name was cleared: list prices from here on. */
  onCleared: () => void;
  onReload: () => void;
  /**
   * Step 1130 — the reader's language overlay (`function_descriptions/{CODE}`),
   * read by the page for `users/{uid}.preferred_language`; null renders the
   * English this file used to hard-code. Every string below goes through it.
   */
  strings: FunctionDescriptions | null;
  className?: string;
}) {
  const t = (key: string, vars?: Record<string, string | number>) =>
    discountPromptText(key, strings, vars);
  const [typed, setTyped] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** "change" on an applied client re-opens the box without clearing the store. */
  const [changing, setChanging] = useState(false);

  // The gate — see the header. A run without groups shows nothing at all.
  if (groups.length === 0) return null;

  const loaded = tables.kind === "loaded" ? tables : null;
  const known = loaded?.clients ?? [];
  // ⚠️ The stored name, resolved against the table ON THE SERVER for this load
  // (the Step-1104 rule, moved there by L6): a name the table no longer knows
  // arrives as `client: null` and must not read as applied.
  const applied = discountClient && loaded?.client ? loaded.client : null;

  async function apply(name: string) {
    setSaveError(null);
    setBusy(true);
    let r: Awaited<ReturnType<typeof applyPricingDiscountClient>>;
    try {
      r = await applyPricingDiscountClient(docId, name);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("pricing_discount__save_failed"));
      setBusy(false);
      return;
    }
    setBusy(false);
    if (r.kind !== "match") {
      setAsk({ kind: r.kind, typed: name.trim(), candidates: r.candidates });
      return;
    }
    setAsk(null);
    setChanging(false);
    setTyped("");
    onApplied(r.name, r.client, r.sourceFile);
  }

  async function clear() {
    setSaveError(null);
    setBusy(true);
    try {
      await setPricingDiscountClient(docId, null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("pricing_discount__clear_failed"));
      setBusy(false);
      return;
    }
    setBusy(false);
    setChanging(false);
    setAsk(null);
    setTyped("");
    onCleared();
  }

  // Step 1107 — the operator's draft: the lead names the fact, the bold half
  // says what to do, and the group codes are NOT listed here (they are on the
  // no-table notice below, where they say which columns a table needs).
  // Step 1130 — every line is the reader's language: WHOLE sentences from the
  // overlay, the group codes filled into a `{groups}` placeholder so the
  // translation can put the parenthetical where its grammar wants it.
  // ⚠️ The parenthetical and the sentence it goes into fall back TOGETHER
  // (`discountPromptOverlayFor`): one language per line, never English around
  // a translated "(grupės …)" or the reverse.
  const noTableOverlay = discountPromptOverlayFor(
    ["pricing_discount__no_table", "pricing_discount__groups"],
    strings,
  );
  const groupsParen =
    groups.length === 0
      ? ""
      : ` ${discountPromptText("pricing_discount__groups", noTableOverlay, {
          list: `${groups.slice(0, 4).join(", ")}${groups.length > 4 ? "…" : ""}`,
        })}`;

  let body: React.ReactNode;
  if (tables.kind === "loading") {
    body = (
      <span className="inline-flex items-center gap-2 text-subhead text-muted-foreground">
        <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        {t("pricing_discount__looking")}
      </span>
    );
  } else if (tables.kind === "error") {
    body = (
      <span className="flex items-center gap-2 text-subhead">
        <span className="text-destructive">{tables.message}</span>
        <ReloadButton onClick={onReload} t={t} />
      </span>
    );
  } else if (known.length === 0) {
    // Groups on the run, no table to price them with — say so, once, quietly.
    body = (
      <span className="flex items-center gap-2 text-subhead text-muted-foreground">
        <span>
          {discountPromptText("pricing_discount__no_table", noTableOverlay, {
            groups: groupsParen,
          })}
        </span>
        <ReloadButton onClick={onReload} t={t} />
      </span>
    );
  } else if (applied && !changing) {
    // Applied: one line, and the Match step's own Next is the way to the prices
    // — a second blue button saying the same thing was two ways forward.
    body = (
      <span className="inline-flex min-h-8 items-center text-subhead text-muted-foreground">
        <span>
          {withNode(
            t("pricing_discount__applied"),
            "name",
            <span className="font-semibold text-foreground">{applied.name}</span>,
          )}
          {" · "}
          <button
            type="button"
            onClick={() => setChanging(true)}
            disabled={busy}
            className="underline decoration-muted-foreground/60 underline-offset-2 hover:text-foreground"
          >
            {t("pricing_discount__change")}
          </button>
          {" · "}
          {/* Step 1117 (L1) — the way back. It writes `null`, the value
              `setPricingDiscountClient` has accepted since Step 1104 and
              nothing had ever sent. */}
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy}
            className="underline decoration-muted-foreground/60 underline-offset-2 hover:text-foreground"
          >
            {t("pricing_discount__list_prices")}
          </button>
        </span>
        {saveError ? (
          <span className="pl-2 text-footnote text-destructive">{saveError}</span>
        ) : null}
      </span>
    );
  } else {
    body = (
      <div className="flex flex-col gap-2">
        {/* The operator's draft (Step 1107): the fact, then the instruction in
            bold; the box takes the full row with Apply at its right. */}
        <p className="text-subhead text-foreground">
          {t("pricing_discount__ask_lead")} —{" "}
          <span className="font-semibold">{t("pricing_discount__ask_instruction")}</span>
        </p>
        {discountClient && !applied ? (
          <p className="text-footnote text-warn">
            {t("pricing_discount__stale", { name: discountClient })}
          </p>
        ) : null}
        <form
          className="flex items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && typed.trim()) void apply(typed);
          }}
        >
          <input
            type="text"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              if (ask) setAsk(null);
            }}
            placeholder={t("pricing_discount__placeholder")}
            aria-label={t("pricing_discount__aria")}
            autoComplete="off"
            className="h-11 min-w-0 flex-1 rounded-control bg-fill1 px-4 text-[15px] text-ink placeholder:text-ink2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-act"
          />
          <button
            type="submit"
            disabled={busy || typed.trim().length === 0}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-act px-6 text-[15px] font-bold text-white hover:bg-act-press disabled:opacity-50"
          >
            {busy ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            {t("pricing_discount__apply")}
          </button>
        </form>
        {applied ? (
          /* Step 1108 (the operator's draft): "keep X" on its own line UNDER the
             box, aligned with its text — not beside Apply, where a third control
             in the row read as a second action. */
          <p className="pl-3">
            <button
              type="button"
              onClick={() => {
                setChanging(false);
                setAsk(null);
                setTyped("");
              }}
              className="text-subhead text-muted-foreground underline decoration-muted-foreground/60 underline-offset-2 hover:text-foreground"
            >
              {t("pricing_discount__keep", { name: applied.name })}
            </button>
          </p>
        ) : null}
        {ask ? (
          <div className="flex flex-col gap-1 text-footnote">
            <span className={cn(ask.kind === "none" ? "text-warn" : "text-foreground")}>
              {ask.kind === "ambiguous"
                ? t("pricing_discount__ambiguous", { typed: ask.typed })
                : ask.kind === "short"
                  ? t("pricing_discount__short", { n: CLIENT_MATCH_MIN_CHARS })
                  : t("pricing_discount__none", { typed: ask.typed })}
            </span>
            <span className="flex flex-wrap gap-1.5">
              {(ask.kind === "ambiguous" ? ask.candidates : known).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => void apply(name)}
                  className="rounded-full bg-fill2 px-3 py-1 font-semibold text-ink hover:bg-sel hover:text-link"
                >
                  {name}
                </button>
              ))}
            </span>
          </div>
        ) : null}
        {saveError ? <p className="text-footnote text-destructive">{saveError}</p> : null}
      </div>
    );
  }

  return <div className={cn("min-w-0", className)}>{body}</div>;
}

function ReloadButton({ onClick, t }: { onClick: () => void; t: (key: string) => string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(iconButtonClass(), "h-8 w-8 shrink-0 rounded-chip")}
      title={t("pricing_discount__reload_title")}
      aria-label={t("pricing_discount__reload_aria")}
    >
      <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}
