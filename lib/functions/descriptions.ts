/**
 * The Pricing discount prompt's copy — sebtember's `lib/functions/descriptions.ts`, the discount
 * block only, copied verbatim (Plugent is English-only, so the overlay is always null and every
 * string renders its English). Change it in sebtember first, then copy.
 */

/** A language overlay of translated strings, by key (sebtember's `function_descriptions/{lang}`). */
export type FunctionDescriptions = Partial<Record<string, string>>;

export const DISCOUNT_PROMPT_COPY: { key: string; english: string }[] = [
  {
    key: "pricing_discount__looking",
    english:
      "The price lists carry discount references — looking for the discount table in your catalogues…",
  },
  {
    key: "pricing_discount__no_table",
    english:
      "The price lists carry discount references{groups}, but no discount table was found in your catalogues. One is a sheet that crosses clients with discount groups — a row per client and a column per group, or the other way round — with the percentage in each cell.",
  },
  { key: "pricing_discount__groups", english: "(groups {list})" },
  { key: "pricing_discount__ask_lead", english: "The price lists carry discount references" },
  { key: "pricing_discount__ask_instruction", english: "enter the beneficiary" },
  { key: "pricing_discount__applied", english: "Prices are discounted for {name}" },
  { key: "pricing_discount__change", english: "change" },
  { key: "pricing_discount__list_prices", english: "list prices" },
  {
    key: "pricing_discount__stale",
    english:
      "“{name}” is not in the discount table any more — prices are list prices until a client is chosen.",
  },
  { key: "pricing_discount__placeholder", english: "Beneficiary name …" },
  { key: "pricing_discount__aria", english: "Who is the discount for?" },
  { key: "pricing_discount__apply", english: "Apply" },
  { key: "pricing_discount__keep", english: "keep {name}" },
  {
    key: "pricing_discount__ambiguous",
    english: "Several clients match “{typed}” — type more of the name, or pick one:",
  },
  {
    key: "pricing_discount__short",
    english: "Type at least {n} characters of the name, or pick one:",
  },
  { key: "pricing_discount__none", english: "“{typed}” is not in the discount table. It knows:" },
  {
    key: "pricing_discount__reload_title",
    english: "Look for the discount table again — after adding groups or clients to it.",
  },
  { key: "pricing_discount__reload_aria", english: "Reload the discount table" },
  { key: "pricing_discount__save_failed", english: "Could not save the client." },
  { key: "pricing_discount__clear_failed", english: "Could not clear the client." },
];

/** The discount prompt's English, by key. */
export const DISCOUNT_PROMPT_EN: Record<string, string> = Object.fromEntries(
  DISCOUNT_PROMPT_COPY.map((c) => [c.key, c.english]),
);

/** The `{placeholders}` a template carries, in order of first appearance. */
export function templatePlaceholders(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(/\{([a-z_]+)\}/g)) {
    const name = m[1] ?? "";
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Does a stored translation still carry every placeholder its English has?
 *
 * ⚠️ THE GUARD THAT MAKES A MODEL TRANSLATION SAFE TO RENDER. A translator that
 * "helpfully" renders `{groups}` as words, or drops `{n}`, would otherwise put
 * a sentence with a hole in it — or with the wrong number in it — in front of
 * the user. Such a string is treated as missing: the English renders instead.
 */
export function templateKeepsPlaceholders(english: string, translated: string): boolean {
  return templatePlaceholders(english).every((p) => translated.includes(`{${p}}`));
}

/** Fill `{placeholders}`; an unknown placeholder is left as it is. */
export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{([a-z_]+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** Is the overlay's translation of this key present and safe to render? */
export function discountPromptUsable(
  key: string,
  overlay: FunctionDescriptions | null | undefined,
): boolean {
  const english = DISCOUNT_PROMPT_EN[key] ?? "";
  const translated = overlay?.[key];
  return (
    typeof translated === "string" &&
    translated.trim().length > 0 &&
    templateKeepsPlaceholders(english, translated)
  );
}

/**
 * The overlay, or null, for a SET of keys that render as ONE sentence.
 *
 * ⚠️ FALLBACK IS PER SENTENCE, NOT PER KEY. The no-table notice is two keys —
 * the sentence and the `(groups …)` parenthetical filled into it — and a
 * per-key fallback rendered "The price lists carry discount references
 * (groupes 1774_1), but no discount table…" the moment one of the two was
 * unusable: English around a French parenthetical, in one line. Every key a
 * sentence is built from must be usable, or the whole sentence is English.
 */
export function discountPromptOverlayFor(
  keys: string[],
  overlay: FunctionDescriptions | null | undefined,
): FunctionDescriptions | null {
  if (!overlay) return null;
  return keys.every((k) => discountPromptUsable(k, overlay)) ? overlay : null;
}

/**
 * One discount-prompt string in the reader's language, filled.
 *
 * Falls back to English when the overlay lacks the key OR its translation lost
 * a placeholder (see `templateKeepsPlaceholders`).
 */
export function discountPromptText(
  key: string,
  overlay: FunctionDescriptions | null | undefined,
  vars: Record<string, string | number> = {},
): string {
  const english = DISCOUNT_PROMPT_EN[key] ?? "";
  const source = discountPromptUsable(key, overlay) ? (overlay?.[key] as string) : english;
  return fillTemplate(source, vars);
}
