"use client";

/**
 * PricingView — Plugent's `/agents/pricing/{runId}` page. Sebtember's `PricingView` (its Step
 * 973 and every step since), copied, with four changes and nothing else:
 *
 *   1. THE RUN COMES FROM SEBTEMBER'S PRODUCT API, not from Firestore listeners: the page polls
 *      `/api/agents/pricing` `get` while a step runs (`POLL_MS`), and every step is a POST there.
 *   2. THE FILE GOES STRAIGHT TO SEBTEMBER: `start` returns a signed upload URL, the browser PUTs
 *      the file to it, then `extract` reads it.
 *   3. PLUGENT'S CHROME: its header and agent icon, its "Source:" footer with feedback, and the
 *      turned-off notice. No wallet chip, no token estimate (no estimates anywhere in Plugent),
 *      no creator replies (Plugent's feedback goes to Plugent).
 *   4. `docId` is PLUGENT'S run id; the route maps it to the sebtember pricing.
 *
 * Sebtember's own notes below are kept as they were written.
 *
 * ---
 *
 * PricingView (Step 973) — the `/pricing/{id}` page.
 *
 * Wears the SIBLING SECTIONS' chrome, not a third design: the same
 * three-column grid topbar with a tinted glyph and a centred truncating title
 * that `SpecDocView` uses, the same `no-scrollbar` scroller over a centred
 * `max-w-3xl` column, and the same blank-state rule — with nothing uploaded
 * yet, the one control on the page sits in the MIDDLE of it rather than pinned
 * to a bottom edge under a screenful of empty thread.
 *
 * ⚠️ THE RESULT IS NOT RE-IMPLEMENTED. Every priced row, every column toggle,
 * every coverage/currency/basis guard and the export come from
 * `components/pricing/pricing-parts.tsx`, shared with the chat agent's card.
 * That table's whole job is keeping a total honest; two copies of it is the
 * drift this codebase keeps paying for.
 *
 * ⚠️ THE CLASS STRINGS ARE COPIES of `SpecDocView`'s header and scroller, for
 * the reason Step 939 recorded when it copied them from `MessageList`: sharing
 * them means extracting from a component that also does composers, thinking
 * modes and share dialogs. The cost of a copy is drift — so it is stated here.
 * If the spec-doc header changes, change this with it.
 */
import { FileSpreadsheetIcon, Loader2Icon, RefreshCwIcon, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnswerFooter } from "@/components/agents/ChatAgent";
import { DiscountPrompt } from "@/components/pricing/DiscountPrompt";
import { GatherProgressView } from "@/components/pricing/GatherProgressView";
import type { PricingStage as PricingStep } from "@/components/pricing/PricingTables";
import {
  ExtractTable,
  MatchTable,
  matchTiles,
  PILL,
  PILL_QUIET,
  PriceTable,
  pricedLineCount,
  priceTiles,
  StageAction,
  StageTabs,
  Tiles,
} from "@/components/pricing/PricingTables";
import {
  CancelButton,
  CoverageNote,
  Dismissable,
  ExportButton,
  IplDownloads,
  StatusLine,
  useOptionSelection,
} from "@/components/pricing/pricing-parts";
import { TemplateExportButton } from "@/components/pricing/TemplateExportButton";
import { useDiscountTables } from "@/components/pricing/use-discount-tables";
import { useBalance } from "@/components/shell/BalanceContext";
import { RunMenu } from "@/components/shell/RunMenu";
import { AgentIcon } from "@/components/ui/AgentIcon";
import { type DiscountClient, discountGroupsOf } from "@/lib/agents/ipl/discount";
import type { IplExportDiscount } from "@/lib/agents/ipl/export";
import {
  formatUploadLimit,
  MOI_ACCEPT,
  MOI_MAX_FILE_BYTES,
  MOI_MAX_IMAGE_BYTES,
  MOI_ONE_FILE_MESSAGE,
  MoiInputTooLargeError,
} from "@/lib/agents/moi/types";
import { agentById } from "@/lib/agents/registry";
import type { FunctionDescriptions } from "@/lib/functions/descriptions";
import { droppedFromRequested, visibleConfirmRows } from "@/lib/pricing/confirm";
import { downloadSourceXlsx } from "@/lib/pricing/source-export";
import { moiFileProblem, PricingUploadError, uploadPricingFile } from "@/lib/pricing/upload-client";
import { type PricingInitial, type PricingRunData, pricingInitial } from "@/lib/pricing/view";
import { cn } from "@/lib/utils";

const PRICING_NEW_TITLE = "New pricing";
/** How often the page asks for the run while a step is running. */
const POLL_MS = 2000;
/** Sebtember's refusals, in words. Anything else shows as its code. */
const ERRORS: Record<string, string> = {
  low_balance: "Your Sebtember balance is too low. Top up in Sebtember to continue.",
  busy: "This run is already working.",
  wrong_state: "This step isn't available right now.",
  refused: "Your wallet changed. Reload the page and try again.",
  agent_off: "Pricing is turned off. Turn it on in All agents.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  unavailable: "Sebtember didn't answer. Try again in a moment.",
  no_upload: "The file didn't arrive. Upload it again.",
};

/** ⚠️ The same two thresholds the chat card uses, and for the same reasons:
 *  MATCH_STALE_MS (330s) exceeds the run route's maxDuration (300s), so the
 *  fallback only fires once the function is provably dead and "start over"
 *  cannot race a live run. Below it, a live run reads as dead and a re-run
 *  bills the same work twice — the Step-511 bug. */
const EXTRACT_STALE_MS = 180_000;
const MATCH_STALE_MS = 330_000;

export function PricingView({
  runId,
  runTitle = null,
  enabled,
  initial,
  strings = null,
}: {
  /** Plugent's run id; null on a new pricing, until `start` makes the run. */
  runId: string | null;
  /** The run's name in Plugent (the sidebar's), which a rename changes; sebtember's title otherwise. */
  runTitle?: string | null;
  /** Step 965 — a DISABLED function refuses the run but never confiscates. The
   *  page still renders; only the upload control is withheld, because a
   *  launcher must not offer what the server will refuse. */
  enabled: boolean;
  initial: PricingInitial;
  /** Step 1130 — the reader's language overlay for the discount prompt's copy
   *  (`function_descriptions/{CODE}`), read by the page; null = English. */
  strings?: FunctionDescriptions | null;
}) {
  const [state, setState] = useState<PricingInitial>(initial);
  const [docId, setDocId] = useState<string>(runId ?? "");
  const router = useRouter();
  const { spent } = useBalance();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /**
   * Price lists switched OFF. Stored as the EXCLUSIONS, not the selection, so a
   * column that appears later (a partial run finishing) is visible by default
   * rather than silently missing. View-time only — the run already fetched
   * every list, so toggling is instant and re-runs nothing.
   */
  /* Step 1086 - the per-option selection replaces the price-list toggles: the
     list has no columns to hide any more, and the checkboxes on each option
     are what decides both the total and the export. ⚠️ ONE hook, so the
     sheet and the screen cannot disagree about what was ticked. */
  const {
    selected,
    toggleOption,
    setAll: setAllOptions,
  } = useOptionSelection(state.status === "complete" && state.result ? state.result : null);
  /**
   * Step 1033 — lines the user DESELECTED on the confirm screen.
   *
   * Stored as the EXCLUSIONS rather than the keeps, so that a run that
   * re-extracts and returns more lines gets them selected by default rather
   * than silently dropped. Cleared whenever the source list changes, or a fresh
   * upload would inherit the previous file's deselections.
   *
   * ⚠️ Step 1081 — this is the USER's unticks and nothing else, so it starts
   * EMPTY. Lines with no quantity used to start unticked here (Step 1067);
   * they are now not listed at all, which is `hidden` below — a DERIVED value,
   * because the user cannot change it and storing it as state would let the
   * two disagree.
   */
  const [dropped, setDropped] = useState<Set<number>>(() =>
    droppedFromRequested(initial.sourceItems, initial.requestedIndices),
  );
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Step 1081 — the lines the card does not list at all (no quantity).
   *
   * ⚠️ DERIVED, never state. It is a property of the read, not a choice, and a
   * second copy in state is how the list and the run would come to disagree
   * about which lines exist. `defaultDroppedIndices` carries the fail-open
   * guard: when EVERY line would be hidden it hides none, so this list can
   * never render empty while the run has rows.
   */
  const { items: visibleItems, indices: visibleIndices } = visibleConfirmRows(state.sourceItems);
  const notListed = state.sourceItems.length - visibleItems.length;

  /**
   * The kept indices, derived. `dropped` is the state; this is what the run
   * receives, so the two cannot disagree.
   *
   * ⚠️ Built from the VISIBLE rows, so a hidden line can never be priced even
   * if a stale `dropped` set somehow failed to mention it.
   */
  const keptIndices = visibleIndices.filter((i) => !dropped.has(i));
  const selectedSet = new Set(keptIndices);

  function toggleItem(index: number) {
    setDropped((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }
  /**
   * Step 1145 — the header's tick-all. `dropped` is the EXCLUSIONS (above), so
   * "all kept" is an empty set and "none kept" is every VISIBLE index — never
   * a hidden line, which the run must not receive whatever the box says.
   */
  function setAllItems(on: boolean) {
    setDropped(on ? new Set() : new Set(visibleIndices));
  }
  const allKept = visibleIndices.length > 0 && keptIndices.length === visibleIndices.length;

  /**
   * The run, from sebtember (through Plugent's route). Sebtember's page holds three Firestore
   * listeners here; Plugent cannot listen to sebtember's Firestore, so it ASKS: once whenever a
   * step returns, and every `POLL_MS` while one is running so progress moves.
   */
  const refresh = useRef<() => Promise<void>>(async () => {});
  refresh.current = async () => {
    if (!docId) return;
    const res = await fetch("/api/agents/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get", runId: docId }),
    }).catch(() => null);
    if (!res?.ok) return;
    const run = (await res.json().catch(() => null)) as PricingRunData | null;
    if (run) setState(pricingInitial(run));
  };
  const polling = state.status === "extracting" || state.status === "matching" || busy;
  useEffect(() => {
    if (!polling || !docId) return;
    const id = setInterval(() => void refresh.current(), POLL_MS);
    return () => clearInterval(id);
  }, [polling, docId]);

  /**
   * ⚠️ A new source list means the old indices point at OTHER lines, so the
   * selection has to reset with it. Keyed on the filename AND the length, so a
   * re-upload of the same file still resets.
   *
   * Adjusted during render rather than in an effect — React's own documented
   * pattern for "reset state when a prop changes", and here it is also the
   * correct one: an effect resets a render LATE, leaving one frame in which the
   * previous file's deselections are applied to the new file's lines.
   */
  const listKey = `${state.sourceFilename}|${state.sourceItems.length}`;
  const [lastListKey, setLastListKey] = useState(listKey);
  if (listKey !== lastListKey) {
    setLastListKey(listKey);
    // ⚠️ Re-derived, not emptied. Emptying here would tick the contents page
    // back on for every run after the first render — the default has to be the
    // same rule in both places or it holds only until the list changes.
    // ⚠️ FROM THE STORED SELECTION, matching the initialiser rather than
    //    emptying (Step 1095). A new upload has none — `RUN_RESET_FIELDS`
    //    deletes it — so this still starts every box ticked on a new file,
    //    which is what the empty set used to mean here. What it now ALSO
    //    handles is the case that made this key stop firing: the list length no
    //    longer changes when a run claims it, so a run's own selection has to
    //    come from the document rather than from a reset.
    setDropped(droppedFromRequested(state.sourceItems, state.requestedIndices));
  }

  // Tick while in flight so a stuck run crosses the staleness threshold and
  // re-renders the fallback even without a new snapshot.
  const [now, setNow] = useState(() => Date.now());
  const inFlight = state.status === "extracting" || state.status === "matching";
  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [inFlight]);

  /**
   * Step 819 — CONTINUE a paused run. A long list cannot match inside one
   * invocation, so the route stops on its own deadline and marks the doc
   * `continue_needed`. Continuation is client-driven because the route needs
   * the caller's session and cannot mint one for itself.
   *
   * ⚠️ The ref guard is load-bearing: the listener fires on every progress
   * write, and without it each write would launch another POST.
   */
  const continuingRef = useRef(false);
  // A continuation that pauses again leaves the flags as they were, so each finished one ticks
  // this to re-run the effect for the next.
  const [continueTick, setContinueTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `post` is a fresh closure each render; the tick and the flags decide when to run.
  useEffect(() => {
    if (!state.continueNeeded || state.status !== "matching") {
      continuingRef.current = false;
      return;
    }
    if (continuingRef.current) return;
    continuingRef.current = true;
    void (async () => {
      try {
        // Same request id, the next continuation number: sebtember charges it as its own line.
        continuation.current.n += 1;
        const ok = await post("match", {
          requestId: continuation.current.requestId,
          continue: continuation.current.n,
        });
        // Only a continuation that worked arms the next; a refusal shows and stops here.
        if (ok === true) setContinueTick((t) => t + 1);
      } catch {
        // The next progress write re-arms this; a genuinely stopped run is
        // caught by the staleness fallback.
      } finally {
        continuingRef.current = false;
      }
    })();
  }, [state.continueNeeded, state.status, docId, continueTick]);

  /** The match request this run is on, so a continuation charges as its next line. */
  const continuation = useRef<{ requestId: string | undefined; n: number }>({
    requestId: undefined,
    n: 0,
  });

  /**
   * One step, to Plugent's route. A step answers with the run, which replaces the page's state
   * at once (no wait for the next poll), and with the wallet's balance after its charge.
   */
  async function post(action: string, extra?: Record<string, unknown>, id = docId) {
    const res = await fetch("/api/agents/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, runId: id, ...extra }),
    });
    const data = (await res.json().catch(() => ({}))) as PricingRunData & {
      error?: unknown;
      balanceAfter?: unknown;
      requestId?: unknown;
    };
    if (!res.ok) return { error: ERRORS[String(data.error)] ?? data.error };
    if (typeof data.balanceAfter === "number") spent(data.balanceAfter);
    if (typeof data.requestId === "string") continuation.current.requestId = data.requestId;
    if (typeof data.status === "string") setState(pricingInitial(data));
    else await refresh.current();
    return true;
  }

  async function onPick(file: File | null) {
    if (!file || busy) return;
    // Step 1159 — the type and the size are checked BEFORE the upload, for the
    // picker and a drop alike: a refusal names its reason instead of arriving
    // as a failed upload after the wait.
    const problem = moiFileProblem(file);
    if (problem) {
      setActionError(problem);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const { runId: newId } = await uploadPricingFile(file);
      setDocId(newId);
      setState((s) => ({
        ...s,
        status: "extracting",
        title: file.name,
        sourceFilename: file.name,
      }));
      // The sidebar's history gains the run now; the URL only once the read is back. ⚠️ A new
      // `[[...run]]` param REMOUNTS this page from the server's render, and a run read mid-way
      // still says `draft` there, so moving the URL first dropped the read on the floor.
      router.refresh();
      const ok = await post("extract", undefined, newId);
      if (ok === true) router.replace(`/agents/pricing/${newId}`, { scroll: false });
      // A refusal stays on this page so its sentence is not remounted away; the run is in the sidebar.
      else setActionError(typeof ok.error === "string" ? ok.error : "Couldn't read that file.");
    } catch (err) {
      // ⚠️ An oversize file is a KNOWN, actionable condition whose message
      // names the actual size — surfaced verbatim rather than as a generic
      // failure that points the user at their document's CONTENT.
      setActionError(
        err instanceof MoiInputTooLargeError || err instanceof PricingUploadError
          ? err.message
          : "Couldn't upload that file.",
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function startRun(keep: number[]) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      // ⚠️ The selection is sent only when it NARROWS. Omitted otherwise, so an
      // untouched confirm screen posts exactly the body it always did — and
      // `undefined` keeps meaning "price everything" on the server.
      // A new match: a new request id (the route mints it), continuations from 0.
      continuation.current = { requestId: undefined, n: 0 };
      setState((s) => ({ ...s, status: "matching", progress: null, result: null }));
      const ok = await post(
        "match",
        keep.length === state.sourceItems.length ? undefined : { keep },
      );
      if (ok !== true) {
        setActionError(typeof ok.error === "string" ? ok.error : "Couldn't start pricing.");
        await refresh.current();
      }
    } catch {
      setActionError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(force = false) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await post("cancel", force ? { force: true } : undefined);
    } catch {
      setActionError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * ⚠️ Step 1095 — SPLIT, because the two clocks now belong to different
   * PANELS. They were one boolean while the page was one column: a dead
   * extraction and a dead match rendered the same "didn't finish" block in the
   * same place. With a stepper they cannot share a branch — an extraction that
   * died is a fact about stage 1, and the user must not find it on stage 2.
   */
  /**
   * ## ⚠️ Step 1098 — THIS ANCHORED ON THE WRONG TIMESTAMP, and it was a live bug
   *
   * It read `createdAtMs`, which `createPricing` writes once when `+ New` makes
   * the row and never refreshes. A draft row exists precisely so the user can
   * leave and come back to it — so coming back the next day and uploading made
   * `now - createdAt` a DAY, instantly past the 180 s threshold, and the card
   * announced "This didn't finish — it may have timed out" over a gather that
   * had just started.
   *
   * ⚠️ THE MATCH HALF NEVER HAD THE BUG, and says why in its own comment:
   * `matching_started_at` exists because "the run sits in awaiting_confirmation
   * for an unbounded, user-controlled time, so a created_at anchor would flag a
   * just-started run as stale". The extract half is the same shape and simply
   * never got the field. `gather_started_at` is it.
   *
   * ⚠️ FALLS BACK TO `createdAtMs` for runs written before the field, which is
   * the old behaviour — wrong in the same rare way, and better than a run that
   * can never go stale at all.
   */
  const gatherStartedAt = state.gatherStartedAtMs ?? state.createdAtMs;
  const extractStale =
    state.status === "extracting" &&
    (gatherStartedAt ?? 0) > 0 &&
    now - (gatherStartedAt ?? 0) > EXTRACT_STALE_MS;
  const matchStale =
    state.status === "matching" &&
    (state.matchingStartedAtMs ?? 0) > 0 &&
    now - (state.matchingStartedAtMs ?? 0) > MATCH_STALE_MS;
  const stale = extractStale || matchStale;

  /**
   * ## The stepper (Step 1095)
   *
   * Three values, and keeping them apart is what makes going back safe:
   *
   *   `runStep`  where the RUN is — a fact about the document.
   *   `reached`  the furthest step it has UNLOCKED. Anchored on
   *              `matching_started_at`, which survives a completed run and is
   *              deleted by a new upload, so stage 2 never re-locks a result
   *              the user paid for and never stays unlocked over a fresh file.
   *   `view`     where the USER is looking. Follows `runStep` when the run
   *              advances, and otherwise stays exactly where it was put.
   */
  const matchStarted = state.matchingStartedAtMs !== null;
  const runStep: PricingStep =
    state.status === "matching" ||
    state.status === "complete" ||
    (state.status === "error" && matchStarted)
      ? 2
      : 1;
  // Step 1104 — the Price step needs nothing run: it prices the ticked options
  // against the discount table at view time, so it unlocks the moment there is
  // a finished result to price. Free to enter, free to leave.
  const priced =
    state.status === "complete" && state.result !== null && state.result.items.length > 0;
  const reached: PricingStep = priced ? 3 : matchStarted || state.status === "complete" ? 2 : 1;
  const [view, setView] = useState<PricingStep>(runStep);
  /**
   * Step 1105 — the discount table, ONCE for the page. The Match step asks who
   * the discount is for and the Price step prices for them; both read this.
   * ⚠️ Gated on the run's own groups (free — the stored result, on the client),
   * so a run whose prices carry none never fetches the table.
   */
  const groupsOnRun = useMemo(
    () => (state.result ? discountGroupsOf(state.result) : []),
    [state.result],
  );
  const discountTables = useDiscountTables(docId, priced && groupsOnRun.length > 0);
  /**
   * The client as this page knows it: the store, echoed the moment it lands
   * (the DiscountPanel's own "store wins" rule, lifted a level), and set here
   * the instant the Match step's ask has WRITTEN it — so the Price step opens
   * on the client without a frame of "No discount" while the listener catches
   * up. ⚠️ Set only after the write resolves, never optimistically.
   */
  const [discountClient, setDiscountClient] = useState<string | null>(state.discountClient);
  const [lastStoredClient, setLastStoredClient] = useState(state.discountClient);
  if (state.discountClient !== lastStoredClient) {
    setLastStoredClient(state.discountClient);
    setDiscountClient(state.discountClient);
  }
  /**
   * Step 1110 — the Price step's sheet, for the Source row: the beneficiary's
   * row as the page's one load of the table resolved it (the SAME row the
   * panel prices on — Step 1117 moved that resolution to the server), so the
   * sheet the row downloads is the sheet the card shows. Absent on the Match
   * step, whose sheet is unchanged.
   */
  const exportDiscount = useMemo<IplExportDiscount>(() => {
    const t = discountTables.tables;
    if (!discountClient || t.kind !== "loaded" || !t.client)
      return { client: null, sourceFile: "" };
    return { client: t.client, sourceFile: t.sourceFile };
  }, [discountClient, discountTables.tables]);
  /**
   * ⚠️ ADJUSTED DURING RENDER, not in an effect — React's own documented
   * pattern, and the same one `listKey` above uses. An effect would move the
   * user a frame LATE, so pressing Next would flash the confirm list they just
   * left before the progress line replaced it.
   *
   * ⚠️ AND IT FOLLOWS THE RUN RATHER THAN BEING SET BY THE BUTTON. If the POST
   * is refused — no balance, function disabled, rate limit — the run never
   * reaches stage 2, so neither does the user: they stay on the list with the
   * error under it. A button that navigated on click would strand them on an
   * empty stage.
   */
  const [lastRunStep, setLastRunStep] = useState<PricingStep>(runStep);
  if (runStep !== lastRunStep) {
    setLastRunStep(runStep);
    setView(runStep);
  }
  /**
   * ⚠️ Step 1128 — AND IT FOLLOWS A RE-MATCH, which the rule above cannot see.
   * `runStep` is ALREADY 2 on a finished run, so "Refresh" on the Extract step
   * (Step 1095) re-claimed the run, deleted the priced result and started
   * identification again while the user stayed on the list they had just
   * re-ticked — 2 → 2 is no change, so nothing moved them. The transition that
   * means "identification is running again" is the STATUS entering `matching`,
   * and that is what moves the view now (operator: "the button should jump to
   * Match page and start identification process again").
   *
   * ⚠️ ON THE TRANSITION, NOT ON THE STATE, or a user who went back to the list
   * DURING a run would be pulled to Match on every progress write. And a
   * CONTINUATION (Step 1032) never enters `matching` — the status was `matching`
   * throughout, only `continue_needed` flips — so someone reading the list
   * while a paused run resumes is left where they are.
   *
   * ⚠️ STILL THE RUN, NOT THE BUTTON: a refused Refresh (no balance, 429) never
   * changes the status, so the user stays on the list with the error under it —
   * the same property the rule above has, for the same reason.
   */
  const [lastStatus, setLastStatus] = useState(state.status);
  if (state.status !== lastStatus) {
    setLastStatus(state.status);
    if (state.status === "matching") setView(2);
  }

  const agent = agentById("pricing");
  // A rename from the header's menu shows at once; the run's own title otherwise.
  const [renamed, setRenamed] = useState<string | null>(runTitle);
  const title = renamed ?? (state.title.length > 0 ? state.title : PRICING_NEW_TITLE);
  const isBlank = state.status === "draft";

  /**
   * Step 1159 — the upload zone takes a DROPPED file as well as a click
   * (operator: "Allow user drag-and-drop file … One file").
   *
   * ⚠️ ONE FILE: a drop of several is refused with a sentence, never quietly cut
   * to its first — which of them is "first" is the file manager's order, and
   * pricing the wrong list costs a paid read. The picker cannot select several
   * (no `multiple`), so the drop is the only door that needs the rule.
   *
   * ⚠️ A DROP BYPASSES `accept`, so `onPick` runs `moiFileProblem` (the type,
   * parsed from `MOI_ACCEPT` itself, and the storage rule's size caps) for both
   * doors before anything is uploaded.
   */
  const [dragging, setDragging] = useState(false);
  const carriesFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  function onDropFiles(files: File[]) {
    if (busy || files.length === 0) return;
    if (files.length > 1) {
      setActionError(MOI_ONE_FILE_MESSAGE);
      return;
    }
    void onPick(files[0] ?? null);
  }
  /**
   * ⚠️ A FILE DROPPED BESIDE THE ZONE MUST NOT OPEN IN THE TAB. The browser's
   * default for a drop it is not told about is to navigate to the file — which
   * replaces the whole app with the PDF, run and all. While the zone is on the
   * page, the window swallows file drops the zone did not take; text and link
   * drags are left alone.
   */
  useEffect(() => {
    if (!isBlank || !enabled) return;
    const swallow = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, [isBlank, enabled]);

  const picker = (
    <div className="flex w-full max-w-md flex-col items-center gap-3">
      <input
        ref={fileRef}
        type="file"
        accept={MOI_ACCEPT}
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        data-upload-zone=""
        data-dragging={dragging ? "" : undefined}
        onClick={() => fileRef.current?.click()}
        onDragEnter={(e) => {
          if (!carriesFiles(e)) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (!carriesFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = busy ? "none" : "copy";
        }}
        onDragLeave={(e) => {
          // Leaving for one of the zone's own children is not leaving the zone.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onDropFiles(Array.from(e.dataTransfer.files));
        }}
        disabled={busy}
        className={cn(
          "flex w-full flex-col items-center gap-2 rounded-card border border-dashed",
          "border-hairline-strong bg-card px-6 py-10 text-center transition-colors",
          "hover:border-info hover:bg-info/5 disabled:opacity-50",
          dragging && "border-info bg-info/5",
        )}
      >
        {busy ? (
          <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <UploadIcon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="text-sm font-medium text-foreground">
          {busy
            ? "Uploading…"
            : dragging
              ? "Drop the file to upload"
              : "Upload a list of materials"}
        </span>
        {/* Step 1159 — HOW (one file, dragged or chosen) and HOW BIG, from the
            same constants the pre-flight enforces and the storage rule sets, so
            the sentence cannot promise a size the upload then refuses. */}
        <span className="text-footnote text-muted-foreground">
          Drag one file here or click to choose. Model numbers optional.
        </span>
        <span className="text-footnote text-muted-foreground">
          PDF, Word, Excel or CSV up to {formatUploadLimit(MOI_MAX_FILE_BYTES)} · images up to{" "}
          {formatUploadLimit(MOI_MAX_IMAGE_BYTES)}
        </span>
      </button>
      {actionError ? (
        <p role="alert" className="text-body text-destructive">
          {actionError}
        </p>
      ) : null}
    </div>
  );

  /**
   * STAGE 1 — Extract. What the file held, and which of it to price.
   *
   * ⚠️ EVERY BRANCH HERE IS ABOUT THE READ. The stale-extraction fallback moved
   * in with them: it used to sit in a shared branch with the stale MATCH, which
   * put a "your extraction died" message on whichever column the user happened
   * to be looking at.
   */
  const extractPanel = extractStale ? (
    <Dismissable
      text="This didn't finish — it may have timed out. Start over and try again."
      onCancel={() => void cancel(true)}
      busy={busy}
    />
  ) : state.status === "extracting" ? (
    /* ⚠️ Step 1098 — the bar, or the old line when there is nothing to say yet.
       `gatherProgress` is null for the first moment of every run (before the
       first write lands) AND permanently for runs that predate the field, so
       the fallback is not a nicety — it is what most of the corpus renders. */
    state.gatherProgress !== null ? (
      <GatherProgressView progress={state.gatherProgress} startedAtMs={gatherStartedAt} />
    ) : (
      <StatusLine label="Reading your file…" />
    )
  ) : state.status === "error" && !matchStarted ? (
    <Dismissable
      text={state.error || "Couldn't read this file. Please try a different one."}
      destructive
      onCancel={() => void cancel()}
      busy={busy}
    />
  ) : state.sourceItems.length === 0 ? (
    /* ⚠️ A ZERO-ITEM READ IS NOT NECESSARILY AN EMPTY DOCUMENT, and saying so
       flatly was the worst version of this card's silence: a 158-line tender
       that read down to nothing was told its file has no materials in it. The
       coverage note is what tells the two apart, so it renders here too. */
    <div className="flex flex-col gap-2">
      <CoverageNote
        read={0}
        coverage={state.coverage}
        capped={state.capped}
        itemsSizeCut={state.itemsSizeCut}
      />
      <Dismissable
        text={
          /* ⚠️ Audit F5 — `stoppedEarly` is a THIRD reason a zero-item read is
             not an empty document, and it is the one this branch could not have
             known about: the gather now halts on its own budget, which leaves
             `total_count` at 0 and no shortfall, so without this clause a file
             that was never read would be reported as containing nothing. And
             unlike the other two, "try uploading it again" is the wrong advice
             — the same file will stop at the same place. */
          state.coverage.stoppedEarly
            ? "Reading stopped at a time limit before anything was read. Split the file into smaller uploads and try those."
            : state.coverage.totalCount > 0 || state.coverage.shortfall
              ? "Nothing was read from this file. Try uploading it again — if it keeps coming back empty, the file may need splitting."
              : "No materials or equipment were found in this file."
        }
        onCancel={() => void cancel()}
        busy={busy}
      />
    </div>
  ) : (
    /* ⚠️ THE CHAT ANSWER CARD, class for class. This whole block is an ANSWER —
       what the read found, the lines it found, and what it will cost to price
       them — and it was the only one in the product rendered as loose text on
       the page background. These are `MessageList`'s classes, which
       `SpecDocView` already copies for the same reason (Step 939), so the three
       surfaces read as one product. */
    /* Plugent's look (the canvas's Pricing board): the totals as tiles, the lines as one table
       with column headings, the coverage note under it, and one pill action. The rules in the
       comments below are sebtember's and still hold. */
    <>
      <Tiles
        tiles={[
          { label: "Lines read", value: state.sourceItems.length },
          { label: "Ticked to match", value: keptIndices.length, tone: "ok" },
          ...(notListed > 0
            ? [
                {
                  label: "Not listed",
                  value: notListed,
                  title: "Lines with no quantity. They are in the XLS.",
                },
              ]
            : []),
        ]}
      />
      {/* ⚠️ NO `max-h` / `overflow-y`: the page already scrolls, a list the user has to CHECK
          is never a peephole. ⚠️ The VISIBLE rows with their canonical indices alongside, so a
          hidden row never re-aims a checkbox. */}
      <ExtractTable
        items={visibleItems}
        indices={visibleIndices}
        selected={selectedSet}
        onToggle={toggleItem}
        allChecked={allKept}
        onToggleAll={setAllItems}
      />
      <div className="text-[13px] text-ink2">
        <CoverageNote
          read={state.sourceItems.length}
          coverage={state.coverage}
          capped={state.capped}
          itemsSizeCut={state.itemsSizeCut}
          notListed={notListed}
          selectedCount={keptIndices.length}
        />
      </div>
      {actionError ? (
        <p className="text-[13px] text-danger" role="alert">
          {actionError}
        </p>
      ) : null}
      <StageAction
        note={
          matchStarted
            ? "Matches the ticked lines again and replaces the result."
            : "Each ticked line is matched to a product in your catalogues."
        }
      >
        {/* ⚠️ It exports what was READ, never the selection (sebtember Step 1081): the lines
            with no quantity are only seen here. */}
        <ExportButton
          label="XLS"
          icon={<FileSpreadsheetIcon size={15} aria-hidden="true" />}
          onClick={() =>
            void downloadSourceXlsx(
              state.sourceItems,
              state.coverage,
              state.capped,
              state.itemsSizeCut,
              selectedSet,
              state.sourceFilename,
            )
          }
        />
        <button
          type="button"
          onClick={() => void startRun(keptIndices)}
          /* ⚠️ Step 1095 — DISABLED WHILE THE RUN IS GOING: on a paused run the click would be
             taken as the continuation and resume with the selection ignored. */
          disabled={busy || keptIndices.length === 0 || inFlight}
          title={inFlight ? "This run is still going." : undefined}
          className={PILL}
        >
          {busy ? (
            <Loader2Icon className="h-5 w-5 animate-spin" aria-hidden="true" />
          ) : matchStarted ? (
            /* ⚠️ Step 1095 — "Refresh" once this list has been matched: the label is the only
               place a user learns the click REPLACES a priced result. */
            <>
              <RefreshCwIcon className="h-4 w-4" aria-hidden="true" />
              Refresh
            </>
          ) : (
            `Match ${keptIndices.length} ${keptIndices.length === 1 ? "line" : "lines"}`
          )}
        </button>
      </StageAction>
    </>
  );

  /**
   * STAGE 2 — Match. Each line resolved to a product, with its prices.
   *
   * Its Next sits at the foot of the panel, under the discount ask (Steps
   * 1104-1107), and opens the Price step — a VIEW over the ticks and the table,
   * so nothing there can refuse it. (⚠️ This comment said "Stage 3 is not
   * built" until Step 1117; it had been built at 1104 and the comment was
   * never revisited — audit L7.)
   */
  const matchPanel = matchStale ? (
    state.result && state.result.items.length > 0 ? (
      <div className="flex flex-col gap-2">
        <p className="text-[15px] text-ink2">
          This didn&apos;t finish. Showing the{" "}
          <span className="font-semibold text-ink">{state.result.items.length}</span>{" "}
          {state.result.items.length === 1 ? "line" : "lines"} completed before it stopped.
        </p>
        <MatchTable
          result={state.result}
          selected={selected}
          onToggleOption={toggleOption}
          onToggleAll={setAllOptions}
        />
        <div className="flex justify-end">
          {/*
            Audit F3 — ⚠️ A PAUSED RUN OFFERS "Continue", NEVER "Start over".
            The server refreshes `matching_started_at` when it pauses, but a user
            returning after 330 s saw the stale branch at the same instant the
            continuation effect posted /run — so clicking "Start over"
            force-cancelled a run that had just resumed.
          */}
          {state.continueNeeded ? (
            <span className="text-[13px] text-ink2">Resuming…</span>
          ) : (
            <CancelButton onClick={() => void cancel(true)} busy={busy} label="Start over" />
          )}
        </div>
      </div>
    ) : state.continueNeeded ? (
      // ⚠️ Same F3 rule as the with-results branch: a run that is deliberately
      // waiting to be continued must never be offered a force-cancel, whether or
      // not it has produced a line yet.
      <StatusLine label="Resuming…" />
    ) : (
      <Dismissable
        text="This didn't finish — it may have timed out. Start over and try again."
        onCancel={() => void cancel(true)}
        busy={busy}
      />
    )
  ) : state.status === "matching" ? (
    // Audit F2 — ⚠️ A RUNNING MATCH COULD NOT BE STOPPED FROM THE PAGE. The
    // cancel route already supported it, the match loop already checked
    // `cancel_requested` between batches, and the terminal write already handled
    // a cancelled run with coverage guards in the table and the export. The only
    // missing piece was the button — so until the 330 s staleness fallback
    // fired, a 500-line run (three continuations, well over 150k tokens) could
    // not be aborted and every batch was billed.
    //
    // ⚠️ A NON-FORCE cancel: it asks the loop to stop between batches and KEEPS
    // the lines already paid for. Force is "start over", which throws them away.
    <div className="flex flex-col gap-2">
      <StatusLine
        label={
          state.progress && state.progress.total > 0
            ? `Identifying ${state.progress.done}/${state.progress.total}…`
            : "Identifying models in your catalogues…"
        }
      />
      <div className="flex justify-end">
        <CancelButton onClick={() => void cancel()} busy={busy} label="Stop" />
      </div>
    </div>
  ) : state.status === "error" ? (
    <Dismissable
      text={state.error || "Pricing failed. Please try again."}
      destructive
      onCancel={() => void cancel()}
      busy={busy}
    />
  ) : state.result ? (
    /* The canvas's Match board: tiles, the line table (No-match rows in warn), the discount ask
       in its own card, and one pill to the Price stage. Step 1106 — NO Total on this stage. */
    <>
      <Tiles tiles={matchTiles(state.result)} />
      <MatchTable
        result={state.result}
        selected={selected}
        onToggleOption={toggleOption}
        onToggleAll={setAllOptions}
      />
      {/* Step 1105 — who the discount is for, asked under the list; a name that resolves STORES
          it and opens the Price stage on it. Renders nothing on a run without groups. */}
      {groupsOnRun.length > 0 ? (
        <div className="rounded-list bg-card px-5 py-4 shadow-card">
          <DiscountPrompt
            docId={docId}
            groups={groupsOnRun}
            tables={discountTables.tables}
            discountClient={discountClient}
            onApplied={(name, client, sourceFile) => {
              setDiscountClient(name);
              // Step 1117 (L6) — the server resolved the row; price on it now.
              discountTables.apply(client, sourceFile);
              setView(3);
            }}
            onCleared={() => {
              // Step 1117 (L1) — back to list prices, on this stage.
              setDiscountClient(null);
              discountTables.apply(null, "");
            }}
            onReload={discountTables.reload}
            strings={strings}
          />
        </div>
      ) : null}
      {/* Step 1104 — the one way forward. ⚠️ It sets the view directly: the Price stage runs
          nothing, so nothing can refuse it (unlike stage 1's paid run). */}
      <StageAction
        note={
          discountClient
            ? `Priced for ${discountClient}.`
            : groupsOnRun.length > 0
              ? "List prices unless you choose a client above."
              : "List prices from your price lists."
        }
      >
        {downloads(false)}
        <button type="button" onClick={() => setView(3)} className={PILL}>
          {(() => {
            const n = pricedLineCount(state.result, selected);
            return `Price ${n} ${n === 1 ? "line" : "lines"}`;
          })()}
        </button>
      </StageAction>
    </>
  ) : null;

  /**
   * STAGE 3 — Price. The ticked options priced for one client. See
   * `DiscountPanel` for what it is and why every figure is view-time.
   */
  /** The sheet download, beside each stage's action (the export follows the ticks, so what you
   *  download is what you are looking at). Step 1110 — on the Price stage it is the discounted
   *  sheet; on Match, the plain one. */
  function downloads(onPrice: boolean) {
    if (!state.result || state.result.items.length === 0 || state.status !== "complete")
      return null;
    return (
      <IplDownloads
        result={state.result}
        selected={selected}
        fileBase={state.sourceFilename}
        discount={onPrice ? exportDiscount : undefined}
        className="mt-0! shrink-0"
      />
    );
  }

  /** The client the Price stage prices for: the stored name's row, once the table has it
   *  (`DiscountPanel`'s rule — a name the table no longer knows prices at list). */
  const priceClient: DiscountClient | null =
    discountClient && discountTables.tables.kind === "loaded" ? discountTables.tables.client : null;
  const tablesState = discountTables.tables;
  const pricePanel =
    state.result && state.result.items.length > 0 ? (
      <>
        <Tiles tiles={priceTiles(state.result, selected, priceClient)} />
        {/* Every state a reader must not miss (sebtember's DiscountPanel, Step 1112): the table
            loading, failed, or a stored name it no longer knows. */}
        {tablesState.kind === "loading" && discountClient ? (
          <StatusLine label="Looking for a discount table in your catalogues…" />
        ) : tablesState.kind === "error" ? (
          <p className="flex items-center gap-3 text-[15px] text-danger">
            {tablesState.message}
            <button type="button" onClick={discountTables.reload} className={PILL_QUIET}>
              Look again
            </button>
          </p>
        ) : discountClient && !priceClient && tablesState.kind === "loaded" ? (
          <p className="flex flex-wrap items-center gap-3 text-[15px] text-warn">
            &ldquo;{discountClient}&rdquo; is not in the discount table any more. Prices below are
            list prices.
            <button type="button" onClick={discountTables.reload} className={PILL_QUIET}>
              Look again
            </button>
          </p>
        ) : null}
        <PriceTable
          result={state.result}
          selected={selected}
          client={priceClient}
          /* Step 1110 — the priced list written into one of the user's templates. */
          footer={
            <StageAction>
              {downloads(true)}
              <TemplateExportButton docId={docId} selected={selected} client={discountClient} />
            </StageAction>
          }
        />
      </>
    ) : null;

  return (
    <>
      {/* Plugent's run header, as every agent page wears it, with the stages as a pill switch on
          its right (the canvas's Pricing board). ⚠️ OUTSIDE THE SCROLLER, so a long list cannot
          scroll the only way back to the result away. */}
      <header className="flex flex-wrap items-center gap-3 border-hair border-b-[0.5px] px-4 py-3.5 min-[600px]:px-8">
        <AgentIcon agent={agent} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-[17px] font-bold">{title}</h1>
          <p className="truncate text-[13px] text-ink2">
            Pricing
            {state.sourceFilename && state.sourceFilename !== title
              ? ` · ${state.sourceFilename}`
              : ""}
            {state.tokensUsed > 0 && ` · ${state.tokensUsed.toLocaleString("en-US")} tokens so far`}
          </p>
        </div>
        {isBlank ? null : (
          <StageTabs
            current={view}
            reached={reached}
            running={state.status === "matching"}
            onSelect={setView}
            /* On a phone the switch takes its own row under the title, so the title can be read. */
            className="max-[599px]:w-full"
          />
        )}
        {docId && !isBlank ? (
          <RunMenu runId={docId} title={title} leaveTo={agent.href} onRenamed={setRenamed} />
        ) : null}
      </header>

      {/* BLANK — nothing uploaded, so the one control IS the page and sits in
          the middle of it (the Step-943/944 rule: just the control, no intro
          copy; the header already names the pricing). */}
      {isBlank ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 pb-10">
          {enabled ? (
            <div className="flex w-full flex-col items-center gap-5">
              <div className="flex flex-col items-center gap-3 text-center">
                <AgentIcon agent={agent} size="card" />
                <h2 className="text-[22px] font-bold">Price a list of materials</h2>
                <p className="max-w-[460px] text-[15px] leading-[22px] text-ink2">
                  Upload a tender or a bill of materials. Each line is matched to a product in your
                  catalogues and priced from your price lists.
                </p>
              </div>
              {picker}
            </div>
          ) : (
            <p className="max-w-md text-center text-body text-muted-foreground">
              Pricing is turned off, so no new list can be priced. Turn it on in{" "}
              <span className="font-medium text-foreground">All agents</span> to start one.
            </p>
          )}
        </div>
      ) : (
        <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-6 min-[600px]:px-8">
          <div className="mx-auto flex max-w-[1040px] flex-col gap-4">
            {/* ⚠️ NO FILENAME LINE (operator's call, Step 1096). It sat above
                the card on every stage and named a file the user had just
                uploaded — the header already carries the pricing's title, which
                IS that filename until the row is renamed, so this was the same
                string twice within 100px.

                ⚠️ `state.sourceFilename` IS STILL READ, and must be: it is the
                export's `fileBase` on both stages, so the downloaded sheet is
                still named after the document. What went is the DISPLAY. */}
            {view === 1 ? extractPanel : view === 2 ? matchPanel : pricePanel}

            {/* ⚠️ ONE FOOTER ROW, AND IT IS THE CHAT ANSWER FOOTER'S (operator's
                ask, Step 1094): "Source:" on the left, the export on the right,
                and ONLY on mobile do the buttons drop below. These are
                `MessageList`'s own classes verbatim — the same copy `SpecDocView`
                makes (Step 939) and this page's answer card already makes (Step
                1089), for the same reason: three surfaces reading as one product
                beats three spellings of one footer. The XLS button used to sit on
                a row of ITS OWN under the Source row, so a completed run ended in
                two right-aligned strips with nothing between them.

                ⚠️ Step 1007's credit is unchanged — same owners, same gate, same
                card. What moved is where the button sits relative to it.

                ⚠️ IT STAYS BELOW THE CARD. The button was lifted into the Source
                ROW, not into the result frame: Step 403's rule that a result
                ACTION is about the card rather than a control within it is
                untouched.

                ⚠️ AND IT BELONGS TO STAGE 2 (Step 1095). It credits the price
                lists and exports the priced table, so on the Extract step it
                would sit under a list that has neither.

                ⚠️ THE EMPTY LEFT COLUMN IS A `<span />`, NOT A MISSING CHILD, and
                that is chat's own fix rather than an invention. With
                `justify-between` and a single child the button slides LEFT — and
                a run that credits nobody is the ordinary case until a price list
                has a resolvable owner, so the broken layout would have been the
                common one. `CreatorsFooter` returns exactly this for exactly this
                reason ("the footer's left column collapses, letting the copy
                button sit alone on the right"). */}
            {(view === 2 || view === 3) &&
            state.status !== "complete" &&
            stale &&
            state.result !== null &&
            state.result.items.length > 0 ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                {/* The run's token-spend line (Step 1117 audit L4 — "This run:
                    N tokens") was REMOVED by operator decision: no token-usage
                    data in the UI. ⚠️ The `<span />` STAYS for the uncredited
                    case — with `justify-between` and a single child the export
                    slides LEFT, so the empty left column holds the row's
                    geometry (the `CreatorsFooter` rule). */}
                <span />
                {/* The export follows the toggles, so what you download is what
                    you are looking at. */}
                {state.result && state.result.items.length > 0 ? (
                  <IplDownloads
                    result={state.result}
                    selected={selected}
                    fileBase={state.sourceFilename}
                    /* Step 1134 — the two-tab feedback control rides the export
                       row (content owner = the price-list providers; Sebtember
                       team = the operator). */
                    /* Step 1110 — on the Price step this is the discounted
                       sheet (`-pricelist.xlsx`); on Match, the plain one. */
                    discount={view === 3 ? exportDiscount : undefined}
                    /* ⚠️ `mt-0` UNDOES THE DEFAULT rather than replacing the box:
                       the margin exists so the RETIRED card's downloads clear the
                       card above them, and inside a vertically centred row it
                       would push this button off centre. `cn()` resolves the two
                       margin utilities, which is the one thing tailwind-merge is
                       reliable at. */
                    className="mt-0! shrink-0"
                  />
                ) : null}
              </div>
            ) : null}

            {/* Plugent's answer footer: whose price lists priced it ("Source:"), and feedback.
                Sebtember's creator replies are not here; Plugent's feedback goes to Plugent. */}
            {(view === 2 || view === 3) &&
            state.result !== null &&
            state.result.items.length > 0 &&
            (state.status === "complete" || stale) ? (
              <AnswerFooter
                owners={state.contentOwners.map((o) => ({
                  label: o.isSelf ? "You" : o.name,
                  own: o.isSelf,
                }))}
                runId={docId}
                question={state.sourceFilename}
                answer={`Pricing of ${state.sourceFilename}: ${state.result.items.length} lines`}
              />
            ) : null}

            {/* ⚠️ NO "Price another list" HERE any more (operator's call), and
                what goes with it is worth stating. That button ran a NON-force
                cancel on a finished run, which reset this document to `draft` so
                the same row could be re-used for a different file — so removing
                it also settles what a pricing IS: ONE priced list, the way a
                specification is one specification. A second list is a second row,
                from the sidebar's "+ New".

                ⚠️ Step 1095 gave the FIRST half of that button back under a name
                that says what it does: "Refresh" on the Extract step re-prices
                THIS list. What is still gone is the half that re-used the row for
                a DIFFERENT file, which is what made the old label wrong. */}
          </div>
        </div>
      )}
    </>
  );
}
