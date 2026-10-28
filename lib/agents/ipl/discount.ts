/**
 * Stage 3 — discounts (Step 1104). PURE and client-safe: no Firestore, no
 * model, no React. The page, the export and `eval:ipl-price` all run exactly
 * this code, so the screen and the sheet cannot disagree about a net price.
 *
 * ⚠️ ONE KIND, TWO ORIENTATIONS (Step 1103 measured the kind; Step 1143 the
 * second orientation). Every supplier price list in the corpus carries a
 * DISCOUNT GROUP on every row (`Nuolaidos grupė: 1771_4`), and a matrix maps
 * `(client, group) → %`. The matrix may be written EITHER way round — a row
 * per client with a column per group (the corpus's first one), or a row per
 * group with a column per client or client TIER (the operator's ERP export,
 * `Kodas | Pavadinimas | Privatus | Nuolaida % Rangovas-S | …`). Both read
 * into the same `DiscountMatrix`; see `matrixFromRows`. There are zero
 * per-item percent columns and zero prose discounts, so this module knows the
 * `group` kind only. A `rate` or `prose` kind, and a one-column per-group rate
 * table, are not built until a file needs one — the same "measure before
 * building" rule that declined the LLM code fallback.
 *
 * ⚠️ THE REFERENCE IS CAPTURED AT MATCH TIME, THE DISCOUNT IS RESOLVED AT VIEW
 * TIME. `findPrices` reads the price row once and keeps its group on the
 * stored `IplPrice` (`discountGroup`); the matrix is looked up when the user
 * opens the Price step and picks a client. So changing the client re-derives
 * every figure instantly and re-runs nothing — the rule every other IPL
 * threshold already follows — and extending the matrix is picked up on the
 * next page load rather than on the next paid run.
 *
 * ⚠️ NEVER A SILENT LIST PRICE. A line the matrix does not cover prices at
 * list and SAYS SO on the row and in the totals — "group 0400_0 not in the
 * discount table". At 31% coverage that is the common case, not an edge case.
 *
 * ⚠️ SUM-THEN-ROUND (Step 1101). Net unit prices are kept at full precision;
 * every total sums them and rounds once for display.
 */

import { pricedOptionsOf, quantityFor } from "@/lib/agents/ipl/derive";
import { isPriceHeader } from "@/lib/agents/ipl/price-parse";
import type { IplPrice, IplResult, IplResultItem } from "@/lib/agents/ipl/types";

// ---------------------------------------------------------------- the reference

/**
 * The price-row column that names the discount group.
 *
 * ⚠️ NAME-MATCHED HERE, SHAPE-CHECKED BELOW, and the split is deliberate. At
 * match time only the row is in hand, so the header decides; but the VALUE must
 * be code-shaped, or the matrix's own header — `Klientas \ Nuolaidos grupė`,
 * which matches this same pattern — would yield a CLIENT NAME as a group (the
 * Step-921 misread). A matrix row never reaches `findPrices` (it has no money
 * column), but the guard costs nothing and the eval pins it.
 */
export const DISCOUNT_GROUP_HEADER = /nuolaid|discount|rabat|skont/i;
/** `1771_4`, `0322_1`, `KG-3`: short, alphanumeric, carries a digit, no spaces. */
export const GROUP_CODE = /^(?=.*\d)[A-Z0-9][A-Z0-9_\-./]{1,11}$/i;
/** `15`, `12.5`, `0,749`, `50%` — a number, not a code. */
const PLAIN_NUMBER = /^\d+([.,]\d+)?\s*%?$/;
/**
 * A cell VALUE that is a group code. ⚠️ `GROUP_CODE` alone is not enough for a
 * value: `15` is code-shaped by that pattern (a digit, short, no spaces), and
 * a matrix's percent cells are exactly such numbers — so a value is a code only
 * when it is NOT a plain number, the same guard `discountGroupOf` applies.
 */
export function isGroupCodeValue(raw: unknown): boolean {
  const v = String(raw ?? "").trim();
  return v.length > 0 && GROUP_CODE.test(v) && !PLAIN_NUMBER.test(v);
}
/**
 * Step 1117 (audit L5) — a header that NAMES the client column: `Klientas \
 * Nuolaidos grupė`, `Client`, `Customer`, `Pirkėjas`. Preferred over position
 * when present; see `matrixFromRows`.
 */
export const CLIENT_COLUMN_HEADER = /klient|client|customer|pirk/i;

/** The group a price row refers to, or null when the row carries none. */
export function discountGroupOf(
  cells: ReadonlyArray<{ header: string; value: string }>,
): string | null {
  for (const c of cells) {
    // A `%` header is a per-item RATE column, a different kind (none in the
    // corpus today) — and a bare number under any header is a percent or a
    // price, never a group. `1771_4` has an underscore; `15` does not.
    if (!DISCOUNT_GROUP_HEADER.test(c.header) || c.header.includes("%")) continue;
    const v = c.value.trim();
    if (PLAIN_NUMBER.test(v)) continue;
    if (GROUP_CODE.test(v)) return v;
  }
  return null;
}

// ---------------------------------------------------------------- the matrix

/** One client's row of the matrix: group code → percent (0–100). */
export interface DiscountClient {
  /** As written in the table — the picker shows it verbatim. */
  name: string;
  percents: Record<string, number>;
}

export interface DiscountMatrix {
  sourceFile: string;
  catalogueId: string;
  /**
   * Step 1143 — which way the table is written. `rows`: a row per client, the
   * groups across the top (`Klientas \ Nuolaidos grupė | 0111_1 | …`).
   * `columns`: a row per group, the clients across the top (`Kodas | … |
   * Privatus | Nuolaida % Rangovas-S | …`). Both read into the same `clients`.
   */
  orientation: "rows" | "columns";
  /** The header of the column that names the client (`rows`), "" for `columns`. */
  clientColumn: string;
  /** The header of the column that carries the group code (`columns`), "" for `rows`. */
  groupColumn: string;
  clients: DiscountClient[];
}

/** `50`, `50 %`, `62,5` → a percent in [0, 100]; anything else is not one. */
export function parsePercent(raw: unknown): number | null {
  const s = String(raw ?? "")
    .replace("%", "")
    .replace(",", ".")
    .trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/**
 * Read a matrix out of a file's rows, or null when the file is not one.
 *
 * ⚠️ BY SHAPE, NEVER BY NAME OR FILENAME (Step 921 / 1103): a matrix is a file
 * whose rows are KEYED by group codes — at least two code-shaped keys, at least
 * one of them a group this run's prices actually refer to. That is the rule the
 * corpus scan ran, and it found the one matrix without reading a single
 * header's text.
 *
 * ⚠️ THE CLIENT COLUMN IS NAMED FIRST, POSITIONED SECOND (Step 1117, audit
 * L5). It used to be "the first key that is not code-shaped", which is right
 * for the one matrix in the corpus and wrong the day someone adds a notes
 * column to its left — every row's client would silently become its note,
 * and every typed name would then re-ask. A header matching
 * `CLIENT_COLUMN_HEADER` wins when there is one; the positional rule stays
 * as the fallback for a table whose header says nothing.
 *
 * ⚠️ "AT LEAST ONE OF THIS RUN'S GROUPS", not two: a run that priced only
 * Wavin lines refers to ONE group (`0211_1`), and a rule demanding two would
 * never find the table for it. The cross-tab shape — several code-shaped keys
 * on one row — is what tells a matrix from a price row that happens to carry
 * one group as a VALUE.
 *
 * Every code-shaped key is kept on the client, not only this run's: the picker
 * can then say how many groups the table knows.
 */
export function isMatrixRow(row: Record<string, unknown>, groups: ReadonlySet<string>): boolean {
  const keys = Object.keys(row);
  const codeKeys = keys.filter((k) => GROUP_CODE.test(k));
  // `rows`: the groups are the KEYS, so one row already shows the cross-tab.
  if (codeKeys.length >= 2 && codeKeys.some((k) => groups.has(k))) return true;
  // `columns`: one row holds ONE group, so the run's group cannot be demanded
  // of a sample — the shape is judged here, the coverage by `matrixFromRows`.
  return isTransposedMatrixRow(row);
}

/**
 * Step 1143 — one row of a `columns` matrix: a group code as a VALUE beside at
 * least two percent cells, in a row with NO money column.
 *
 * ⚠️ THE PRICE HEADER IS THE VETO. A price row carries a group as a value too
 * (`Nuolaidos grupė: 1771_4`) beside numbers that can be small (`Kaina: 10`,
 * `Kiekis: 1`); what it always has, and a matrix never has, is a column whose
 * header names money — the same `isPriceHeader` that decides what reaches the
 * price parser. ⚠️ TWO percent cells, not one, for the reason `rows` demands
 * two code keys: several tiers on one row is the cross-tab shape; one number
 * beside a code is what half the tables in a corpus look like.
 */
export function isTransposedMatrixRow(row: Record<string, unknown>): boolean {
  const entries = Object.entries(row);
  if (entries.some(([k]) => isPriceHeader(k))) return false;
  const codes = entries.filter(([, v]) => isGroupCodeValue(v));
  if (codes.length === 0) return false;
  const percents = entries.filter(([, v]) => !isGroupCodeValue(v) && parsePercent(v) !== null);
  return percents.length >= 2;
}

export function matrixFromRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  groups: ReadonlySet<string>,
  where: { sourceFile: string; catalogueId: string },
): DiscountMatrix | null {
  // `rows` first: it is the stricter shape (the run's group is a KEY on every
  // row), so a table that satisfies it is never re-read the other way round.
  return clientRowsMatrix(rows, groups, where) ?? clientColumnsMatrix(rows, groups, where);
}

/** A row per client, a column per group — the corpus's first matrix (Step 1104). */
function clientRowsMatrix(
  rows: ReadonlyArray<Record<string, unknown>>,
  groups: ReadonlySet<string>,
  where: { sourceFile: string; catalogueId: string },
): DiscountMatrix | null {
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
  const codeKeys = [...keys].filter((k) => GROUP_CODE.test(k));
  if (!(codeKeys.length >= 2 && codeKeys.some((k) => groups.has(k)))) return null;
  const nonCode = [...keys].filter((k) => !GROUP_CODE.test(k));
  const clientColumn = nonCode.find((k) => CLIENT_COLUMN_HEADER.test(k)) ?? nonCode[0] ?? "";
  if (!clientColumn) return null;

  const clients: DiscountClient[] = [];
  for (const r of rows) {
    const name = String(r[clientColumn] ?? "").trim();
    if (!name) continue;
    const percents: Record<string, number> = {};
    for (const g of codeKeys) {
      const p = parsePercent(r[g]);
      if (p !== null) percents[g] = p;
    }
    if (Object.keys(percents).length > 0) clients.push({ name, percents });
  }
  return clients.length > 0
    ? { ...where, orientation: "rows", clientColumn, groupColumn: "", clients }
    : null;
}

/**
 * Step 1143 — a row per group, a column per client (or client tier): the
 * operator's ERP export, `Kodas | Prekių grupės pavadinimas | Privatus |
 * Nuolaida % Rangovas-S | … | Nuolaida % Mažmena-L`, 110 groups deep.
 *
 * The GROUP COLUMN is the one whose values are codes on at least half the rows,
 * name at least one of THIS run's groups, and never repeat — a cross-tab lists
 * each group once, where a price list repeats its group on every product of
 * the family (the second guard, after the price-header veto, against reading a
 * supplier list as a discount table). Every other column whose cells are
 * percents on at least half the rows is a CLIENT, named by its header
 * verbatim — `Nuolaida % Rangovas-S` is what the picker shows and what
 * `matchClient` resolves `Rangovas-S` against (a word match). At least two,
 * for the reason `isTransposedMatrixRow` gives.
 */
function clientColumnsMatrix(
  rows: ReadonlyArray<Record<string, unknown>>,
  groups: ReadonlySet<string>,
  where: { sourceFile: string; catalogueId: string },
): DiscountMatrix | null {
  if (rows.length === 0) return null;
  const keys: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  if (keys.some((k) => isPriceHeader(k))) return null;
  const half = Math.ceil(rows.length / 2);

  const groupColumn = keys.find((k) => {
    const values = rows.map((r) => String(r[k] ?? "").trim()).filter((v) => v.length > 0);
    const codes = values.filter((v) => isGroupCodeValue(v));
    if (codes.length < half || !codes.some((c) => groups.has(c))) return false;
    return new Set(codes).size === codes.length;
  });
  if (!groupColumn) return null;

  const clientKeys = keys.filter(
    (k) => k !== groupColumn && rows.filter((r) => parsePercent(r[k]) !== null).length >= half,
  );
  if (clientKeys.length < 2) return null;

  const clients: DiscountClient[] = [];
  for (const k of clientKeys) {
    const percents: Record<string, number> = {};
    for (const r of rows) {
      const code = String(r[groupColumn] ?? "").trim();
      if (!isGroupCodeValue(code)) continue;
      const p = parsePercent(r[k]);
      if (p !== null) percents[code] = p;
    }
    if (Object.keys(percents).length > 0) clients.push({ name: k, percents });
  }
  return clients.length >= 2
    ? { ...where, orientation: "columns", clientColumn: "", groupColumn, clients }
    : null;
}

// ---------------------------------------------------------------- the hint

/**
 * Step 1115 (audit M3) — WHERE the matrix was last found, remembered on the
 * user so the next look costs one read per remembered file instead of a
 * 3-row sample of EVERY file in every accessible catalogue (~130 queries on
 * the operator's corpus, per page open and per export, growing with the corpus).
 *
 * ⚠️ A HINT, NEVER AN ANSWER. The file is READ AGAIN on every use and judged by
 * the same `matrixFromRows` rule; the hint only says where to look first. A
 * hinted file that no longer qualifies — deleted, re-uploaded under a new id,
 * or not covering THIS run's groups — sends the lookup back to the full scan,
 * which is what wrote the hint in the first place.
 *
 * ⚠️ AND ONLY INSIDE THE CALLER'S CURRENT CATALOGUES. The hint is written by
 * the server, but access changes under it: a catalogue the user left must not
 * be read through a path the Admin SDK does not gate.
 */
export interface DiscountMatrixHintFile {
  catalogueId: string;
  fileId: string;
}

export interface DiscountMatrixHint {
  files: DiscountMatrixHintFile[];
}

/** A stored hint's usable shape, or null. Malformed entries are dropped, not thrown. */
export function hintFromDoc(raw: unknown): DiscountMatrixHint | null {
  if (!raw || typeof raw !== "object") return null;
  const files = (raw as { files?: unknown }).files;
  if (!Array.isArray(files)) return null;
  const out: DiscountMatrixHintFile[] = [];
  for (const f of files) {
    if (!f || typeof f !== "object") continue;
    const { catalogueId, fileId } = f as { catalogueId?: unknown; fileId?: unknown };
    if (typeof catalogueId !== "string" || typeof fileId !== "string") continue;
    if (!catalogueId || !fileId || catalogueId.includes("/") || fileId.includes("/")) continue;
    out.push({ catalogueId, fileId });
  }
  return { files: out };
}

/** The hinted files worth trying: inside the caller's catalogues, deduped, bounded. */
export const HINT_MAX_FILES = 5;
export function usableHint(
  hint: DiscountMatrixHint | null,
  catalogueIds: ReadonlyArray<string>,
): DiscountMatrixHintFile[] {
  if (!hint) return [];
  const allowed = new Set(catalogueIds);
  const seen = new Set<string>();
  const out: DiscountMatrixHintFile[] = [];
  for (const f of hint.files) {
    const key = `${f.catalogueId}/${f.fileId}`;
    if (!allowed.has(f.catalogueId) || seen.has(key)) continue;
    seen.add(key);
    out.push(f);
    if (out.length >= HINT_MAX_FILES) break;
  }
  return out;
}

// ---------------------------------------------------------------- the client

/**
 * Legal forms that wrap a company name in Lithuanian documents, at EITHER end:
 * `UAB "Vikjona"`, `Frevita, UAB`, `AB Lifosa`, `MB Elektra`.
 */
// ⚠️ ASCII ONLY, because `\b` is ASCII-only in JS — the diacritics are stripped
// BEFORE this runs (`VšĮ` → `vsi`, `ŽŪB` → `zub`), so the forms are listed as
// they read after that pass.
const LEGAL_FORMS = /\b(uab|ab|mb|vsi|ii|kb|zub|tub|ltd|llc|gmbh|ou|sia|as|oy)\b/gi;

/**
 * Case-folded, diacritics stripped, quotes and commas dropped, legal form
 * removed from either end, separators folded to spaces, whitespace collapsed.
 *
 * ⚠️ EITHER END: `Frevita, UAB` puts the form LAST where the others put it
 * first, so a prefix strip alone leaves `frevita uab` ≠ `frevita`. Measured on
 * the real matrix (Step 1103).
 *
 * ⚠️ SEPARATORS FOLD (Step 1144): `Rangovas-S`, `Rangovas S` and `Rangovas_S`
 * are one name. The operator typed the tier with a space where the header has
 * a hyphen and was told it was not in the table — a punctuation difference is
 * not a different client, so it is removed BEFORE any matching, on both sides.
 */
export function normaliseClientName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/["'„“”‚‘’`]/g, " ")
    .replace(/[,.;:()]/g, " ")
    .replace(/[-_/]/g, " ")
    .replace(LEGAL_FORMS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ClientMatch =
  | { kind: "match"; client: DiscountClient; matrix: DiscountMatrix }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "none"; candidates: string[] }
  /** Step 1117 (audit L2) — too little typed to look for a prefix. */
  | { kind: "short"; candidates: string[] };

/**
 * The fewest normalised characters the loose (prefix / word) path accepts.
 *
 * ⚠️ Step 1117 (audit L2). The loose path took ANY non-empty query, so typing
 * `a` resolved — and STORED — the only client with a word starting in "a".
 * Correct by the rule as written, and still a guess: nobody means a company
 * by one keystroke. An EXACT match is exempt (a client really named `AB`
 * normalises to nothing anyway — the legal form is stripped).
 */
export const CLIENT_MATCH_MIN_CHARS = 3;

/**
 * Step 1144 — how many edits a typed name may be from a client and still mean
 * it: one per five normalised characters. `rangovas s` (10) may be 2 off,
 * `vikjona` (7) 1 off, anything under 5 characters none — a short name is
 * reached exactly or by its word, never by a guess.
 */
export const CLIENT_MATCH_EDITS_PER_CHARS = 5;

/**
 * Damerau-Levenshtein (optimal string alignment): insert, delete, substitute,
 * or swap two neighbours — the four things a hand does to a name.
 */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[] = new Array(rows * cols).fill(0);
  for (let i = 0; i < rows; i++) d[i * cols] = i;
  for (let j = 0; j < cols; j++) d[j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        (d[(i - 1) * cols + j] as number) + 1,
        (d[i * cols + (j - 1)] as number) + 1,
        (d[(i - 1) * cols + (j - 1)] as number) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, (d[(i - 2) * cols + (j - 2)] as number) + 1);
      }
      d[i * cols + j] = best;
    }
  }
  return d[rows * cols - 1] as number;
}

/**
 * The fewest edits from the typed name to any run of whole words in a client's
 * name — `rangovas z` is 1 from the `rangovas s` inside `nuolaida % rangovas s`,
 * not 12 from the whole header. A span is 1..n consecutive words, so a name
 * typed in full is compared with the whole thing too.
 */
function closestSpanDistance(q: string, normalisedName: string): number {
  const words = normalisedName.split(" ");
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j <= words.length; j++) {
      const span = words.slice(i, j).join(" ");
      // A span much shorter or longer than the query cannot be within budget;
      // skip it rather than pay for the table.
      if (Math.abs(span.length - q.length) > Math.max(2, q.length / 2)) continue;
      best = Math.min(best, editDistance(q, span));
      if (best === 0) return 0;
    }
  }
  return best;
}

/**
 * The client the user means, across every matrix found.
 *
 * Exact normalised match first; then — with at least `CLIENT_MATCH_MIN_CHARS`
 * typed — the typed words found at a word boundary inside exactly one name
 * (`rangovas s` inside `nuolaida % rangovas s`; a bare `rangovas` fits three
 * tiers and re-asks); then — Step 1144 — the unique CLOSEST name within
 * `CLIENT_MATCH_EDITS_PER_CHARS`, and only when the runner-up is strictly
 * further: a typo resolves, a tie re-asks with the tied names, and an unknown
 * name re-asks with the table's names ordered nearest first. ⚠️ NEVER GUESS
 * beyond that budget: the wrong client is the wrong price on every line.
 */
export function matchClient(input: string, matrices: ReadonlyArray<DiscountMatrix>): ClientMatch {
  const q = normaliseClientName(input);
  const all = matrices.flatMap((m) => m.clients.map((client) => ({ client, matrix: m })));
  const names = all.map((e) => e.client.name);
  if (!q) return { kind: "none", candidates: names };

  const exact = all.filter((e) => normaliseClientName(e.client.name) === q);
  const one = exact[0];
  if (exact.length === 1 && one) return { kind: "match", client: one.client, matrix: one.matrix };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact.map((e) => e.client.name) };
  if (q.length < CLIENT_MATCH_MIN_CHARS) return { kind: "short", candidates: names };

  // The typed words, whole, at a word boundary — a prefix of a word counts, so
  // `dab` reaches `dabinge` and `rangovas s` reaches the S tier without the
  // header's `nuolaida %` in front of it.
  const loose = all.filter((e) => ` ${normaliseClientName(e.client.name)}`.includes(` ${q}`));
  const first = loose[0];
  if (loose.length === 1 && first)
    return { kind: "match", client: first.client, matrix: first.matrix };
  if (loose.length > 1) return { kind: "ambiguous", candidates: loose.map((e) => e.client.name) };

  // The closest, within budget, and alone there.
  const budget = Math.floor(q.length / CLIENT_MATCH_EDITS_PER_CHARS);
  const ranked = all
    .map((e) => ({ ...e, distance: closestSpanDistance(q, normaliseClientName(e.client.name)) }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = ranked[0];
  const runnerUp = ranked[1];
  if (nearest && nearest.distance <= budget) {
    if (!runnerUp || runnerUp.distance > nearest.distance)
      return { kind: "match", client: nearest.client, matrix: nearest.matrix };
    return {
      kind: "ambiguous",
      candidates: ranked.filter((e) => e.distance === nearest.distance).map((e) => e.client.name),
    };
  }
  return { kind: "none", candidates: ranked.map((e) => e.client.name) };
}

// ---------------------------------------------------------------- the view

/**
 * Step 1117 (audit L6) — what the PAGE is handed: every client's NAME (the
 * ask's candidates) and the percents of ONE client (the one stored on the
 * pricing), for the groups THIS run refers to.
 *
 * ⚠️ NOT THE MATRIX. The whole table — every client's percentages — used to be
 * serialised to the browser so the page could resolve a typed name itself.
 * The lookup spans every catalogue the user can reach, a shared one included,
 * so that was other people's terms in a network response the user never asked
 * to see. The name is resolved on the server now (`matchClient`, the same call
 * the export route makes), and the browser gets the row it prices with.
 *
 * ⚠️ `client` IS THE STORED NAME RESOLVED AGAINST THE TABLE ON THIS LOAD, never
 * an object cached from an earlier one — the Step-1104 rule, moved server-side.
 * A stored name the table no longer knows comes back as `null` with the name
 * still on the document, and the page says so.
 */
export interface DiscountTableView {
  /** The run's own groups — what the table had to cover. */
  groups: string[];
  /** Every client the table(s) know, by name, in table order. */
  clients: string[];
  /** The stored client's row, or null (no client chosen, or the name no longer resolves). */
  client: DiscountClient | null;
  /** The file `client`'s row came from — the sheet's NOTES name it. */
  sourceFile: string;
}

/** A client's row narrowed to the groups a run refers to — nothing else leaves the server. */
export function clientRowFor(
  client: DiscountClient,
  groups: ReadonlyArray<string>,
): DiscountClient {
  const percents: Record<string, number> = {};
  for (const g of groups) {
    const p = client.percents[g];
    if (p !== undefined) percents[g] = p;
  }
  return { name: client.name, percents };
}

// ---------------------------------------------------------------- the price

export type DiscountOutcome =
  /** The matrix names this group for this client: `net` is the discounted unit price. */
  | { kind: "applied"; group: string; percent: number; net: number }
  /** The price carries a group the matrix does not know. List price, and say so. */
  | { kind: "group_not_in_matrix"; group: string; net: number }
  /** The price carries no group at all — the list has none, or the run predates Step 1104. */
  | { kind: "no_group"; net: number }
  /** No client chosen: list price, no claim made. */
  | { kind: "no_client"; net: number };

export function discountFor(price: IplPrice, client: DiscountClient | null): DiscountOutcome {
  if (!client) return { kind: "no_client", net: price.value };
  const group = price.discountGroup?.trim() ?? "";
  if (!group) return { kind: "no_group", net: price.value };
  const percent = client.percents[group];
  if (percent === undefined) return { kind: "group_not_in_matrix", group, net: price.value };
  // Full precision — the display rounds once (Step 1101). `(100 − p) / 100`
  // rather than `1 − p/100`, and a trim at the 10th decimal, so an integer
  // percent on a two-decimal price yields the exact figure (`55`, not
  // `55.00000000000001`) — binary noise is not precision, and it would reach
  // the sheet as a value Excel displays as 55 while storing something else.
  const net = Math.round(((price.value * (100 - percent)) / 100) * 1e10) / 1e10;
  return { kind: "applied", group, percent, net };
}

/** One line of the Price step: the option the user ticked, priced for the client. */
export interface DiscountedRow {
  itemIndex: number;
  item: IplResultItem;
  optionIndex: number;
  match: NonNullable<IplResultItem["match"]>;
  price: IplPrice;
  quantity: number;
  outcome: DiscountOutcome;
  /** `net × quantity`, full precision. */
  lineNet: number;
  /** `list × quantity`, full precision. */
  lineList: number;
}

export interface DiscountTotal {
  currency: string;
  list: number;
  net: number;
  lines: number;
}

export interface DiscountSummary {
  rows: DiscountedRow[];
  totals: DiscountTotal[];
  /** Rows the matrix covered. */
  applied: number;
  /** Rows priced at list because their group is not in the matrix, by group. */
  uncovered: Map<string, number>;
  /** Rows whose price carries no group at all. */
  noGroup: number;
}

/**
 * Every ticked option, priced for the chosen client.
 *
 * ⚠️ THE SAME WALK `summariseSelection` DOES — `pricedOptionsOf` under the same
 * cap, the same quantity — so the Price step's list total equals the Match
 * step's total for the same ticks. A second walk that disagreed by one option
 * would show the user two "list totals".
 *
 * ⚠️ Step 1118 — every ticked, priced option is summed; the confidence floor
 * that used to hold a "below floor" option out of the total is gone.
 */
export function summariseDiscounts(
  result: IplResult,
  selected: ReadonlyMap<number, ReadonlySet<number>>,
  maxOptions: number,
  client: DiscountClient | null,
): DiscountSummary {
  const rows: DiscountedRow[] = [];
  const byCurrency = new Map<string, DiscountTotal>();
  const uncovered = new Map<string, number>();
  let applied = 0;
  let noGroup = 0;

  for (const [itemIndex, item] of result.items.entries()) {
    const ticked = selected.get(itemIndex);
    if (!ticked || ticked.size === 0) continue;
    const quantity = quantityFor(item);
    for (const o of pricedOptionsOf(item, maxOptions)) {
      if (!ticked.has(o.index) || !o.price) continue;
      const outcome = discountFor(o.price, client);
      rows.push({
        itemIndex,
        item,
        optionIndex: o.index,
        match: o.match,
        price: o.price,
        quantity,
        outcome,
        lineNet: outcome.net * quantity,
        lineList: o.price.value * quantity,
      });
      if (outcome.kind === "applied") applied += 1;
      else if (outcome.kind === "group_not_in_matrix")
        uncovered.set(outcome.group, (uncovered.get(outcome.group) ?? 0) + 1);
      else if (outcome.kind === "no_group") noGroup += 1;
      const t = byCurrency.get(o.price.currency) ?? {
        currency: o.price.currency,
        list: 0,
        net: 0,
        lines: 0,
      };
      t.list += o.price.value * quantity;
      t.net += outcome.net * quantity;
      t.lines += 1;
      byCurrency.set(o.price.currency, t);
    }
  }

  return {
    rows,
    totals: [...byCurrency.values()].sort((a, b) => b.lines - a.lines),
    applied,
    uncovered,
    noGroup,
  };
}

/** The distinct groups a result's prices refer to — what a matrix must cover. */
export function discountGroupsOf(result: IplResult): string[] {
  const out = new Set<string>();
  for (const item of result.items) {
    for (const p of item.prices) if (p.discountGroup) out.add(p.discountGroup);
    for (const a of item.alternatives ?? [])
      for (const p of a.prices) if (p.discountGroup) out.add(p.discountGroup);
  }
  return [...out];
}

/** The one-line reason a row is at list price, for the row and the sheet. */
export function discountNote(outcome: DiscountOutcome): string {
  switch (outcome.kind) {
    case "applied":
      return "";
    case "group_not_in_matrix":
      return `group ${outcome.group} not in the discount table — list price`;
    case "no_group":
      return "no discount group on this price — list price";
    case "no_client":
      return "";
  }
}
