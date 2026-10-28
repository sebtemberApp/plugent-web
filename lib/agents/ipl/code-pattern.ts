/**
 * What an article code looks like — sebtember's `functions/keywordTokens.js` `CODE_PATTERN`,
 * copied verbatim (the three constants it is built from). Plugent has no `functions/`, so
 * `price-parse.ts` imports it from here; that one import line is the only change to the copy.
 * Change it in sebtember first, then copy.
 */
const CODE_CONTINUATION = "(?:[\\p{L}\\p{N}_-]|\\.(?=[\\p{L}\\p{N}]))*";
const UPPER_CODE = `(?<![\\p{L}\\p{N}])\\p{Lu}{2,}${CODE_CONTINUATION}`;
const MIXED_CODE = `(?<![\\p{L}\\p{N}])\\p{L}{2,}\\p{N}${CODE_CONTINUATION}`;

export const CODE_PATTERN = [UPPER_CODE, MIXED_CODE].join("|");
