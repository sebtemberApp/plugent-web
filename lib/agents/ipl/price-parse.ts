/**
 * IPL price parsing — PURE. No I/O, no model calls. (Step 725, PR 2.)
 *
 * ⚠️ It gained ONE import at Step 1062 — `CODE_PATTERN`, the shared definition
 * of what an article code looks like. It stays pure (a regex source string, no
 * I/O), and it is imported rather than re-derived because a second copy is
 * exactly how this and the keyword index would come to disagree about what a
 * code IS — which is the defect Step 1052 exists for.
 *
 * Turns an indexed table row back into typed prices. Extraction stores a table
 * row as `Header: value | Header: value | …` (functions/processors/doc.js
 * `rowToText`), so a price list row arrives here looking like:
 *
 *   Code: AC-200P | Description: Circulation pump DN50 | Price EUR: 1.249,00
 *
 * The header survives ingestion, and that is the whole reason this agent can be
 * honest: a bare `1249` is ambiguous between net and gross, and a price list
 * routinely carries both — the extraction eval has a merged-cell fixture with
 * `Price (EUR)` spanning Net and Gross precisely because that is the hard case.
 * So every parsed price KEEPS the header it came from, and the card prints it.
 *
 * Deterministic on purpose. This is the step most likely to be quietly wrong
 * (European vs US decimal separators alone), and a wrong price reaches a
 * customer quote — so it is code with an eval, not a prompt.
 */
import { CODE_PATTERN } from "@/lib/agents/ipl/code-pattern";

/**
 * Words that mean money ON THEIR OWN, matched as WHOLE WORDS.
 *
 * Step 734 (audit C4) — this used to be a SUBSTRING test, which made "rate"
 * match "Rated power" and "Flow rate", "total" match "Total height", and "net"
 * match "Net weight". Not a cosmetic mislabel: the price stage queries every
 * indexed row mentioning the code — datasheet spec rows included — and a price
 * COLUMN emerges from any file that yields a price. So a datasheet became a
 * phantom price column, and in a single row a 3.5 kg weight outranked the real
 * 249,00 price, leading both the line total and the column total.
 */
const PRICE_WORDS = [
  // en
  "price",
  "prices",
  "cost",
  "costs",
  "amount",
  "rrp",
  "msrp",
  // de / nl
  "preis",
  "preise",
  "betrag",
  "netto",
  "brutto",
  "prijs",
  // lt / lv / et / fi
  "kaina",
  "kainos",
  "suma",
  "cena",
  "ceny",
  "hind",
  "hinta",
  // pl / cz / sk / hr / sl
  "kwota",
  "cijena",
  // ru / uk
  "цена",
  "цены",
  "стоимость",
  "сума",
  "ціна",
  // fr / es / it / pt
  "prix",
  "montant",
  "precio",
  "importe",
  "prezzo",
  "preço",
  "valor",
  // scandi
  "pris",
  "belopp",
];

/**
 * Words that mean money only ALONGSIDE a currency. "Net" and "Gross" are real
 * price-column headers ("Net EUR", "Gross EUR") AND real spec headers ("Net
 * weight"), so they cannot qualify alone.
 */
const WEAK_PRICE_WORDS = ["net", "gross", "total", "rate", "sum"];

/**
 * A header naming a PHYSICAL QUANTITY is never a money column, whatever else it
 * contains — this wins over both lists above. It is what stops the audit's exact
 * repro set: Rated power, Net weight, Gross weight, Total height, Flow rate.
 */
const NOT_PRICE_WORDS = [
  "weight",
  "height",
  "width",
  "length",
  "depth",
  "diameter",
  "power",
  "flow",
  "voltage",
  "current",
  "temperature",
  "efficiency",
  "capacity",
  "pressure",
  "speed",
  "volume",
  "mass",
  "area",
  "size",
  "rating",
  "consumption",
  "output",
  "input",
  "frequency",
  "class",
  "index",
  "level",
  "range",
  "vat",
  // non-en equivalents seen in the corpus
  "svoris",
  "aukštis",
  "galia",
  "gewicht",
  "leistung",
  "вес",
  "мощность",
  "waga",
  "moc",
];

/**
 * Currency codes / symbols recognised in a header or beside an amount.
 *
 * Boundaries are LETTER boundaries, not `\b`. `\b` sits between a word char and
 * a non-word char, and a digit is a word char — so `\beur\b` could not see the
 * code in `249,00EUR`, which is exactly how a price list writes it. A letter
 * boundary still rejects `Neuro` and `EUROPE`.
 */
const CURRENCIES: Array<[RegExp, string]> = [
  [/(?<!\p{L})eur(?!\p{L})|€/iu, "EUR"],
  [/(?<!\p{L})usd(?!\p{L})|\$/iu, "USD"],
  [/(?<!\p{L})gbp(?!\p{L})|£/iu, "GBP"],
  [/(?<!\p{L})pln(?!\p{L})|zł/iu, "PLN"],
  [/(?<!\p{L})sek(?!\p{L})/iu, "SEK"],
  [/(?<!\p{L})nok(?!\p{L})/iu, "NOK"],
  [/(?<!\p{L})dkk(?!\p{L})/iu, "DKK"],
  [/(?<!\p{L})czk(?!\p{L})|kč/iu, "CZK"],
  [/(?<!\p{L})chf(?!\p{L})/iu, "CHF"],
  [/(?<!\p{L})uah(?!\p{L})|₴/iu, "UAH"],
  [/(?<!\p{L})rub(?!\p{L})|₽/iu, "RUB"],
];

/** The same codes as bare words, for the glued-to-the-amount case (`249,00EUR`). */
const CURRENCY_CODES = new Set([
  "eur",
  "usd",
  "gbp",
  "pln",
  "sek",
  "nok",
  "dkk",
  "czk",
  "chf",
  "uah",
  "rub",
]);

/** Header words meaning "per what" / "how many" — kept as the price's qualifier. */
const UNIT_WORDS = ["unit", "per", "vnt", "szt", "stk", "pcs", "qty", "kiekis", "einheit"];

export interface ParsedPrice {
  value: number;
  currency: string;
  /** The source column header, verbatim (never normalised away). */
  label: string;
  unit: string;
}

/**
 * The header's words, case-folded. Unicode-aware, so Cyrillic and Baltic headers
 * tokenise the same way English ones do.
 *
 * ⚠️ Built from a regex LITERAL on purpose. The first cut of this used
 * `new RegExp(\`(?<![\p{L}\p{N}])...\`)` — and inside a TEMPLATE LITERAL `\p` is
 * not an escape, it collapses to a bare `p`, so the "word boundary" was really
 * the character class `[p{LN}]` and the test was still a substring match
 * ("Costume" contained "cost"). It passed the eval anyway, because
 * NOT_PRICE_WORDS happened to cover the audit's exact repro set — fixture luck,
 * which is the failure mode this whole module exists to avoid. A literal cannot
 * be mis-escaped.
 */
function headerWords(header: string): Set<string> {
  return new Set(header.match(/[\p{L}\p{N}]+/gu) ?? []);
}

/**
 * Does this header name a money column? (Step 734 / C4.)
 *
 * Order matters. A STRONG price word wins over the physical-quantity veto so
 * "Price incl. VAT" and "Kaina su PVM" — real gross-price headers — survive the
 * "vat" entry that exists to kill "VAT rate". The veto then catches everything
 * whose only claim to being money was a weak word: Rated power, Net weight,
 * Gross weight, Total height, Flow rate.
 */
export function isPriceHeader(header: string): boolean {
  const h = header.toLowerCase();
  const words = headerWords(h);
  if (PRICE_WORDS.some((w) => words.has(w))) return true;
  if (NOT_PRICE_WORDS.some((w) => words.has(w))) return false;
  const hasCurrency = CURRENCIES.some(([re]) => re.test(h));
  // "Net"/"Gross"/"Total" only count when a currency says what they measure.
  if (hasCurrency && WEAK_PRICE_WORDS.some((w) => words.has(w))) return true;
  return hasCurrency;
}

function detectCurrency(...sources: string[]): string {
  for (const s of sources) {
    for (const [re, code] of CURRENCIES) {
      if (re.test(s)) return code;
    }
  }
  return "";
}

/**
 * What a COLUMN's separator means, when the column's own values prove it.
 * `null` = undecided, and the per-token rules apply unchanged.
 */
export type DecimalConvention = "decimal" | null;

/**
 * Decide a column's convention from its own values. (Step 922 / C.)
 *
 * ⚠️ THIS EXISTS BECAUSE THE PER-TOKEN RULES CANNOT REACH THE LAST 11%. A
 * thousands group is always exactly three digits, so `37.7934` (four) and
 * `1842.876` (a four-digit integer part, which grouping would have written
 * `1.842.876`) are both decidable alone. `13.562` is NOT: from the token alone
 * it is either 13.562 or 13562.
 *
 * Measured on the operator's corpus — 233 price cells sit in exactly that shape,
 * and every one of them is a decimal, because the six affected columns contain
 * **no 1–2 decimal values at all**:
 *
 *     column                      1-2dp    3dp   4+dp
 *     Kainynas … (Henco)              0     77    574
 *     Kainynas … (Wavin)              0     63    483
 *     Kainynas … (Viega)              0     42    347
 *     Kainynas … (Haier)              0     34    278
 *     Kainynas … (Hitachi)            0     16    203
 *     Kainynas … (Imera)            110      0      0   <- 2dp column, untouched
 *
 * So one 4+ digit value anywhere in a column settles that column, and `13.562`
 * beside it reads as 13.56 rather than 13,562.
 *
 * ⚠️ MUST BE KEYED PER (FILE, HEADER), NEVER PER HEADER. Imera and Henco share
 * the header `Kainynas, EUR be PVM` and use DIFFERENT conventions — Imera's is a
 * genuine 2dp column where `1.249` really would be 1249. A header-global rule
 * would carry Henco's evidence onto Imera and corrupt it.
 *
 * Returns `null` when nothing proves a convention, which leaves behaviour
 * exactly as it was.
 */
export function detectDecimalConvention(values: Iterable<string>): DecimalConvention {
  for (const raw of values) {
    for (const m of String(raw).matchAll(/(?<![\d.,])(\d+)[.,](\d+)(?![\d.,])/g)) {
      const intPart = m[1] ?? "";
      const frac = m[2] ?? "";
      // A zero integer part proves nothing about GROUPING — `0,749` is already
      // unambiguous on its own and says nothing about its neighbours.
      if (/^0+$/.test(intPart)) continue;
      if (frac.length >= 4 || intPart.length >= 4) return "decimal";
    }
  }
  return null;
}

/**
 * Parse a money amount, handling BOTH decimal conventions.
 *
 * This is the classic trap: `1.249,00` (European) and `1,249.00` (US) are the
 * same number written two ways, and reading one as the other is off by 1000×.
 * Rule used: whichever separator appears LAST is the decimal separator — which
 * is true for both conventions — and if only one kind appears, it is a decimal
 * when the integer part is empty or zero (`0,749` can only be a decimal), or
 * when exactly 1–2 digits follow (`249,00` / `249.5`); otherwise it is a
 * thousands separator (`1.249`, `1,249`).
 *
 * Returns the FIRST amount, or null when the text holds none. Use `parseAmounts`
 * where a cell may legitimately hold more than one.
 */
export function parseAmount(raw: string, hint: DecimalConvention = null): number | null {
  return parseAmounts(raw, hint)[0] ?? null;
}

/**
 * EVERY amount in one cell, in source order. (Step 734 / audit C2 + C3.)
 *
 * The old code stripped everything that was not a digit or separator and parsed
 * the remainder as ONE number. Two failures followed, both producing
 * believable-shaped values rather than errors:
 *
 *   C2  "1.200,00 / 1.450,00" (tier pricing, or net and gross in one cell)
 *       collapsed to 1200001450 - and flowed into line totals and the export.
 *   C3  "12,5 m3/h" became 12.53: the 3 of "m3" merged into the amount, and
 *       "249,00 EUR/100pcs" corrupted the same way.
 *
 * So amounts are TOKENISED instead. A token counts only when it is not glued to
 * letters: that admits both halves of a tier price, rejects the "3" inside "m3"
 * and the "100" of "100pcs", and leaves a spaced trailing unit ("3.5 kg") to the
 * header rules - which is where a physical quantity belongs.
 *
 * Step 735 (audit C8) — a token cannot cross a space, and the pre-clean that
 * used to strip whitespace went out with the old single-number parse. So a
 * SPACE-GROUPED thousands (`1 249,00`) split into two prices, 1.00 and 249.00,
 * and the deterministic sort then led the total with 249.00 — understated by
 * exactly the thousands group, in a believable-shaped number. `10 000` even
 * emitted a second price of 0.00, which reads as free. Space is the standard
 * grouping separator in lt-LT / fr-FR / ru-RU / pl-PL and the Nordics, and PDF
 * price lists — the hero document type — carry whatever the VLM read off the
 * print, so this reached any price >= 1000. `joinGroupedThousands` runs first.
 */
export function parseAmounts(raw: string, hint: DecimalConvention = null): number[] {
  // The trailing `(\p{L}+)?` is deliberately a CAPTURE, not a negative
  // lookahead: a lookahead backtracks, so "100pcs" would shrink the number to
  // "10" and match anyway. Consuming the letters instead lets the run be
  // rejected whole. A LEADING separator is allowed so ",50" reads as 0.50
  // rather than 50 — the C1 case with no integer part at all.
  const out: number[] = [];
  for (const m of joinGroupedThousands(raw).matchAll(
    /(?<![\p{L}\p{N}])(-?[.,]?\d[\d.,]*)(\p{L}+)?/gu,
  )) {
    // Glued letters mean a unit or a word — a qualifier, not an amount. The one
    // exception is a currency CODE (`249,00EUR`), which is how price lists
    // routinely write it; refusing that dropped a real price silently.
    const glued = m[2];
    if (glued && !CURRENCY_CODES.has(glued.toLowerCase())) continue;
    const n = parseOneAmount(m[1] ?? "", hint);
    if (n !== null) out.push(n);
  }
  return out;
}

/**
 * Join space-grouped thousands before tokenising. (Step 735 / audit C8.)
 *
 * Only the UNAMBIGUOUS grouping shape joins: a digit, ONE grouping space, then
 * EXACTLY three digits that are not followed by another digit or a letter.
 * `1 249,00` and `12 345 678,90` join; `DN 50` (two digits), `1-9 @ 10,00` (no
 * digit before the space) and `249,00 100pcs` (letters after) do not.
 *
 * Iterative because a global replace resumes AFTER its own match, so a chained
 * `12 345 678,90` needs a second pass. Each pass strictly shortens the string,
 * so it terminates; the bound is belt-and-braces.
 *
 * The residual ambiguity is a money cell reading `5 100` — genuinely 5100 or
 * genuinely two numbers, undecidable from the text. It joins. That is safe only
 * because the HEADER decides what reaches this function at all: `Qty: 5 100`
 * never gets here, and the eval pins that.
 */
function joinGroupedThousands(raw: string): string {
  let out = raw;
  for (let i = 0; i < 8; i += 1) {
    // U+0020 space, U+00A0 NBSP, U+202F narrow NBSP — all used for grouping.
    const next = out.replace(/(\d)[ \u00A0\u202F](\d{3})(?![\d\p{L}])/gu, "$1$2");
    if (next === out) break;
    out = next;
  }
  return out;
}

function parseOneAmount(token: string, hint: DecimalConvention = null): number | null {
  const cleaned = token.replace(/[^\d.,-]/g, "").replace(/(?!^)-/g, "");
  // A trailing separator is punctuation, not a decimal point.
  const trimmed = cleaned.replace(/[.,]+$/, "");
  if (!/\d/.test(trimmed)) return null;

  const lastComma = trimmed.lastIndexOf(",");
  const lastDot = trimmed.lastIndexOf(".");
  let normalised: string;

  if (lastComma >= 0 && lastDot >= 0) {
    // Both present - the LAST one is the decimal separator.
    const decimalAt = Math.max(lastComma, lastDot);
    const intPart = trimmed.slice(0, decimalAt).replace(/[.,]/g, "");
    const fracPart = trimmed.slice(decimalAt + 1).replace(/[.,]/g, "");
    normalised = `${intPart}.${fracPart}`;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const at = lastComma >= 0 ? lastComma : lastDot;
    const frac = trimmed.slice(at + 1);
    // Step 734 (audit C1) - a 0 or EMPTY integer part can NEVER be a thousands
    // group, so the separator is unambiguously a decimal however many digits
    // follow. Without this "0,749" parsed as 749: a 1000x error, and
    // per-metre / per-kg prices under 1 EUR look exactly like that.
    const intPart = trimmed.slice(0, at).replace(/[-.,]/g, "");
    if (
      intPart === "" ||
      /^0+$/.test(intPart) ||
      /^\d{1,2}$/.test(frac) ||
      // Step 922 (A) — FOUR OR MORE digits after the separator can never be a
      // thousands GROUP, which is always exactly three. `37.7934` is a
      // four-decimal price, not 377934.
      /^\d{4,}$/.test(frac) ||
      // Step 922 (B) — and a single separator with a 4+ digit integer part is
      // not grouped either: 1,842,876 would be written `1.842.876`, so
      // `1842.876` can only be a decimal.
      intPart.length >= 4 ||
      // Step 922 (C) — the column decided. See `detectDecimalConvention`.
      hint === "decimal"
    ) {
      normalised = `${trimmed.slice(0, at).replace(/[.,]/g, "")}.${frac}`;
    } else {
      // Anything else - a thousands separator (1.249 / 1,249 / 1.249.000).
      normalised = trimmed.replace(/[.,]/g, "");
    }
  } else {
    normalised = trimmed;
  }

  const n = Number.parseFloat(normalised);
  return Number.isFinite(n) ? n : null;
}

/**
 * Split an indexed row back into its `Header: value` cells.
 *
 * Splits on `|` (rowToText's separator) and on the FIRST `:` only — a value can
 * legitimately contain a colon ("Type: 3:1 ratio") and splitting greedily would
 * eat it.
 */
export function rowCells(text: string): Array<{ header: string; value: string }> {
  const cells: Array<{ header: string; value: string }> = [];
  for (const part of text.split("|")) {
    const seg = part.trim();
    if (!seg) continue;
    const at = seg.indexOf(":");
    if (at <= 0) continue;
    cells.push({ header: seg.slice(0, at).trim(), value: seg.slice(at + 1).trim() });
  }
  return cells;
}

/**
 * Every price in one row.
 *
 * Returns ALL money columns, not just the first — a row with both Net and Gross
 * yields two, each carrying its own header, and it is the reader (or PR 3's
 * guards) that decides which applies. Collapsing them here would be the exact
 * silently-wrong behaviour this agent must avoid.
 */
export function parseRowPrices(
  text: string,
  /** Per-HEADER conventions for this row's file. See detectDecimalConvention. */
  hints?: ReadonlyMap<string, DecimalConvention>,
): ParsedPrice[] {
  const cells = rowCells(text);
  if (cells.length === 0) return [];

  // A unit qualifier is row-level, not per-price — "per m" applies to whatever
  // money columns the row has.
  const unitCell = cells.find(
    (c) => UNIT_WORDS.some((w) => c.header.toLowerCase().includes(w)) && !isPriceHeader(c.header),
  );
  const unit = unitCell ? `${unitCell.header}: ${unitCell.value}`.slice(0, 60) : "";

  const out: ParsedPrice[] = [];
  for (const cell of cells) {
    // A header that names money, OR a value that carries a currency mark — the
    // second catches an unlabelled column like "€ 249,00".
    const headerSaysMoney = isPriceHeader(cell.header);
    const valueSaysMoney = CURRENCIES.some(([re]) => re.test(cell.value));
    if (!headerSaysMoney && !valueSaysMoney) continue;

    // EVERY amount in the cell, not just the first (Step 734 / audit C2). One
    // cell can legitimately hold two: tier pricing, a range, or net and gross
    // written together. They are kept as separate prices under the same header
    // — merging them was what produced 1200001450, and silently keeping only
    // one would present a guess as the price.
    for (const value of parseAmounts(cell.value, hints?.get(cell.header) ?? null)) {
      // Money is non-negative. (Anything more — a year filter, an identifier
      // filter — is NOT implemented; the header rules are what keep non-money
      // columns out.)
      if (value < 0) continue;

      out.push({
        value,
        currency: detectCurrency(cell.header, cell.value),
        label: cell.header.slice(0, 60),
        unit,
      });
    }
  }
  return out;
}

/**
 * Does this row actually refer to `code`?
 *
 * The keyword index is a RECALL leg — `array-contains-any` returns rows that
 * mention any of the batched codes, so a hit must still be verified against the
 * row's own text before its price is attributed to this item. Comparison is on a
 * normalised form (case-folded, separators dropped) because price lists and
 * datasheets write the same article number differently: `AC-200P`, `AC200P`,
 * `ac 200 p`.
 */
/**
 * How many codes ONE match may be looked up under.
 *
 * Not a tuning dial — a bound on the batch. `findPrices` groups ten codes per
 * `array-contains-any` query and caps the rows it returns, so every extra code
 * is a slot that could starve a real one (Step 815, N3).
 */
const MAX_LOOKUP_CODES = 3;

export function normaliseCode(code: string): string {
  return code.toLowerCase().replace(/[\s._/-]/g, "");
}

export function rowMentionsCode(text: string, code: string): boolean {
  const needle = normaliseCode(code);
  // Guard against a 1–2 char "code" matching everything.
  if (needle.length < 3) return false;
  const hay = normaliseCode(text);

  // Step 734 (audit C5) — a bare `.includes` lost every boundary, so `AC-200`
  // matched an `AC-2000` row and the 3-digit code `200` matched the digit run of
  // the price `1.200,00` itself. Prefix families (DN50/DN500, X-100/X-1000) are
  // the NORM in catalogues, and both members are usually in the same upload —
  // so the substring check guaranteed cross-contamination, which this module
  // states is worse than finding no price at all.
  //
  // The boundary rule is ASYMMETRIC, because that is how article numbers behave:
  // a DIGIT touching either end changes the NUMBER (a different article), while
  // trailing LETTERS mark a variant (AC-200P → AC-200PHT) — which the eval
  // deliberately treats as a hit for PR 3 to surface as multiplicity. A leading
  // letter is likewise allowed so a code named inside prose ("Pump AC-200")
  // still attributes.
  //
  // ACCEPTED FALSE NEGATIVE: normalisation drops whitespace, so a code followed
  // by a spaced number in the SAME cell ("AC-200 400V") reads as `ac200400v` and
  // is refused. That direction is the safe one — a miss is visible in the
  // `[ipl/run] identified= priced=` ratio, a wrong price is not.
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    const before = at > 0 ? (hay[at - 1] ?? "") : "";
    const after = hay[at + needle.length] ?? "";
    if (/\d/.test(before)) continue;
    if (/\d/.test(after)) continue;
    return true;
  }
  return false;
}

/**
 * Is this chunk ONE PRODUCT'S ROW, or a chunk that holds the whole sheet?
 *
 * ⚠️ THE DISTINCTION IS THE FIX (Step 1087). The XLSX branch stores a price
 * list twice on purpose: one `table_row` vector per product, AND a sheet-level
 * chunk holding the file as raw CSV (Step 136). Both are indexed, so a code
 * query returns both — and `rowMentionsCode` accepts the sheet chunk for EVERY
 * code in the file, because it genuinely contains them all.
 *
 * Measured on the operator's own run: the Imera list's sheet chunk yielded 180
 * "prices" — the capacity out of each product NAME (5, 8, 12, 18 … 500) and the
 * discount group `1311_0` read as 1311 and 0 — attributed to all eleven of its
 * codes, and `comparePrices` then picked the highest. Eleven different
 * expansion vessels were quoted at 1311 EUR, overstating that run's total by
 * 9,431.63 EUR (19%). The correct prices (38.78, 42.58, 508.92 …) were sitting
 * in the row chunks of the SAME file, losing on the higher-value tiebreak.
 *
 * ⚠️ AND THE SHEET CHUNK IS NOT A NOISIER SOURCE OF THE SAME ANSWER — it is a
 * different, wrong one. It is raw CSV with no `|`, so `rowCells` sees ONE cell
 * whose header is everything up to the first colon (here the `https://` line)
 * and whose value is the rest of the file. Run on the real excerpt it returns
 * `[1311, 0, 1311, 0, 1311, 0]` and the real prices are absent ENTIRELY. So
 * preferring the row is not a tiebreak preference; it is the difference between
 * a price and a discount group. `eval:ipl-price` pins that on verbatim text.
 *
 * ⚠️ THE ROW IS AUTHORITATIVE BECAUSE IT IS ONE PRODUCT BY CONSTRUCTION. Every
 * ingestion path that emits a per-product record tags it — the XLSX branch, the
 * markdown-table path used by PDFs and DOCX, and the JSON per-record path (all
 * three in `functions/processors/doc.js`) — so this is not an XLSX-only rule.
 *
 * ⚠️ ABSENT IS NOT FALSE-ISH BY ACCIDENT. A legacy vector written before
 * `chunk_role` existed has none, and reads as "not a product row" — which puts
 * that file on the fallback below, i.e. exactly its pre-1087 behaviour. Nothing
 * re-extracts an existing file (the Step-917 rule), so that path has to stay
 * correct rather than merely compile.
 */
export function isProductRowChunk(chunkRole: unknown): boolean {
  return chunkRole === "table_row";
}

/**
 * Keep the prices that came from a product's OWN row; fall back to the rest.
 *
 * ⚠️ A FALLBACK, NEVER A FILTER. Some real price lists produce NO row vectors
 * at all — the K-Flex list whose header sits on row 9, and the pre-885 cohort
 * (Steps 917 / 919-A) — and for those the sheet chunk is the only place a price
 * exists. Dropping it outright would turn "a wrong price" into "no price", which
 * on this surface reads to a buyer as *your supplier does not list it* (the
 * Step-1033 rule). So the sheet chunk keeps its job wherever nothing better
 * exists, and loses it only where something better does.
 *
 * ⚠️ PER CODE, not per file or per run. One file can hold both shapes, and one
 * code can be priced by two files — so the question "is there a real row for
 * THIS code" is the only one whose answer is safe to act on.
 *
 * Generic over whatever else the caller hangs off an entry — `findPrices`
 * carries the catalogue that produced it, so the credit can be computed from
 * what SURVIVED rather than from what was merely attributed.
 */
export function preferProductRowPrices<T extends { fromProductRow: boolean }>(
  found: readonly T[],
): T[] {
  const rows = found.filter((f) => f.fromProductRow);
  return rows.length > 0 ? rows : [...found];
}

/**
 * The codes to LOOK a match's price up under — its own, plus the same article
 * number wearing a supplier prefix. (Step 1062.)
 *
 * ⚠️ THE GAP THIS CLOSES, measured on the operator's only real run: 13 of 15
 * lines were identified at 95% — the code-confirmed band — and 3 were priced.
 * A tender writes `E-242SN3`; the price row's keyword is `hit-e-242sn3`; and
 * `findPrices` matches a keyword EXACTLY, so the row can never be returned.
 * Probed against the live index, all seven failing codes were `bare 0 hits /
 * prefixed 1 hit`. The price was in the catalogue and unreachable.
 *
 * ⚠️ AND THE PREFIX NEVER HAS TO BE DERIVED — it is already in hand. Stage 1's
 * judge reads the actual catalogue row, and returned the prefixed article
 * number as the matched NAME on every line that failed (`HIT-E-242SN3`,
 * `HIT-DXF-20.0A1`), because in that price list the name column IS the article
 * number. The three lines that priced are the ones where it happened to land in
 * `matched_code` instead. So this needs no corpus scan, no per-catalogue prefix
 * cache, no new index and no re-upload — unlike every other option measured.
 *
 * ⚠️ THE FILTER IS THE WHOLE DESIGN, and the loose version was measured doing
 * real harm. Taking every code-shaped token from the name adds `VRF` and
 * `11,2 kW`; `vrf` is a common token, the batch hit `ROWS_PER_QUERY`, and it
 * STARVED `HIT-RCI-4.0FSR1` — a code that priced perfectly well before. That is
 * Step 815's N3 failure exactly. So a name token qualifies only when it is the
 * SAME article number with something in front: strictly longer than the code
 * and ending with it, compared under `normaliseCode` so `-`, `.` and case
 * cannot decide it. Measured with that rule: 13 of 15 priced, 0 capped queries.
 *
 * ⚠️ ONLY the QUERY widens; attribution is untouched, and that is what makes
 * this unable to change a line that already priced. `rowMentionsCode` matches
 * the bare code INSIDE the prefixed one (a `-` is a boundary), so any row the
 * prefixed form attributes, the bare form attributes too — the bare code's
 * bucket is a superset. The extra codes only get the row FETCHED.
 */
export function lookupCodesForMatch(
  match: { code?: string | null; name?: string | null } | null | undefined,
): string[] {
  const code = (match?.code ?? "").trim();
  const want = normaliseCode(code);
  // `findPrices` drops anything shorter anyway (see rowMentionsCode); below it
  // a "suffix" is not evidence of anything.
  if (want.length < 3) return code ? [code] : [];

  const out = [code];
  const seen = new Set([want]);
  // ⚠️ The CODE alternatives only — the full keyword pattern also matches units
  // and dates, which is where `11,2 kW` came from.
  for (const tok of (match?.name ?? "").match(new RegExp(CODE_PATTERN, "gu")) ?? []) {
    const n = normaliseCode(tok);
    if (n.length <= want.length || !n.endsWith(want) || seen.has(n)) continue;
    seen.add(n);
    out.push(tok);
    // A name carries one article number; more than a couple of "prefixed"
    // readings of it means the token soup this filter exists to keep out.
    if (out.length >= MAX_LOOKUP_CODES) break;
  }
  return out;
}
