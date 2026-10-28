# Copied from sebtember-web — change there first

`ipl/{types,derive,export,discount,price-parse}.ts`, `moi/types.ts`, `csv-safe.ts`,
`lib/pricing/{confirm,document}.ts` and `lib/ui/eta.ts` are sebtember's pricing view code, copied
verbatim (sebtember main d035f232) so Plugent's Pricing screens filter, total and export a run exactly
as Sebtember does. The engine itself stays in Sebtember (`/api/products/pricing/*`).

Only change: `price-parse.ts` imports `CODE_PATTERN` from `code-pattern.ts` instead of
`functions/keywordTokens.js`.
