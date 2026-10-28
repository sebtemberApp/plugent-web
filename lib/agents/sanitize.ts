/**
 * Sebtember's prompt hygiene, COPIED VERBATIM from its `lib/chat/sanitize.ts`: `sanitizeForPrompt`
 * for every user-written string spliced into a prompt (chat history, troubleshooting text), and
 * `stripInlineFilenames`, the backstop that keeps file names out of a chat answer's prose.
 * Change them in sebtember first, then copy.
 */

// Structural tags the system instruction / prompt assembly treats as
// boundaries. ANY user- or creator-authored string spliced into the
// prompt must have these stripped, or content can "break out" of its
// block and inject instructions (e.g. a catalogue owner closing
// </catalogue_guidance> then forging <retrieval_strength>rich</…>).
// Keep this list in sync with every <tag> emitted by the prompt
// builders (route.ts, retrieval.ts, persona.ts, project.ts,
// table-annotation.ts). Legacy tags (user_config, output_template,
// past_conversation_context) are retained — harmless and defensive.
const PROMPT_TAG_REGEX =
  /<\/?\s*(user_config|rolling_memory|user_persona|retrieved_data|past_conversation_context|output_template|table_data|catalogue_guidance|retrieval_strength|project_context|complete_findings|response_language|system)[^>]*>/gi;

const SECTION_HEADER_REGEX = /^\s*###\s/gm;

/** Default per-string cap. Mirrors main.py's MAX_USER_QUERY_CHARS / MAX_HISTORY_ITEM_CHARS. */
export const DEFAULT_PROMPT_MAX_LEN = 4000;

/**
 * Strips prompt-tag-looking sequences and section headers from a user-
 * controlled string, then truncates to `maxLen` characters.
 *
 * Returns "" for null / undefined / empty input — safe to compose with
 * `??` when reading optional fields.
 */
export function sanitizeForPrompt(
  value: string | null | undefined,
  maxLen = DEFAULT_PROMPT_MAX_LEN,
): string {
  if (!value) return "";
  const truncated = value.length > maxLen ? value.slice(0, maxLen) : value;
  return truncated.replace(PROMPT_TAG_REGEX, "").replace(SECTION_HEADER_REGEX, "");
}

/* ---------------- Output-side filename stripper (Step 317) ---------- */

// §6 CITATIONS forbids literal filenames in the model's prose — source
// files surface as cards below the reply. The prompt enforces this, but
// under the §7 "rich" depth push the model synthesises across multiple
// files and reliably reverts to attributing each fact with a raw filename
// ("(ištrauka iš report_2026.pdf)", "Dokumente „report_2026.pdf"…").
// Prompt-only enforcement doesn't hold against that pressure, so this is a
// DETERMINISTIC backstop applied to the model's OUTPUT before it's written
// to the message doc. The cards keep the provenance; the prose stays clean.
const STRIPPABLE_EXTENSIONS =
  "pdf|docx?|xlsx?|csv|txt|md|pptx?|json|rtf|odt|ods|png|jpe?g|gif|webp|svg|zip|rar|7z";

// A filename token: a run of non-space, non-bracket, non-quote characters
// ending in one of the extensions above (e.g. `ijms-23-03655.pdf`,
// `jem_20102660.pdf`, `Price_List_2026.xlsx`). The quote class includes the
// curly “ ” „ ‘ ’ marks the model uses around filenames.
const FILENAME_TOKEN = `[^\\s()\\[\\]"'\`\\u201c\\u201d\\u201e\\u2018\\u2019]+\\.(?:${STRIPPABLE_EXTENSIONS})`;

const PAREN_CITATION_RE = new RegExp(
  `\\s*[([][^()\\[\\]]*${FILENAME_TOKEN}[^()\\[\\]]*[)\\]]`,
  "gi",
);
const QUOTED_FILENAME_RE = new RegExp(
  // The closing class includes U+201C deliberately: in German / Lithuanian
  // typography („…“) the CLOSING mark is U+201C — the same glyph English uses
  // to OPEN — so without it a `„report_2026.pdf“` citation (the exact leak
  // pattern this pass targets, and a common one given the Lithuanian user
  // base) would slip through now that the bare-token pass is gone.
  `[\`'"\\u201c\\u201e\\u2018]\\s*${FILENAME_TOKEN}\\s*[\`'"\\u201c\\u201d\\u2019]`,
  "gi",
);
// Step 325 — the BARE (unconditional) filename pass was REMOVED. It was a
// global strip of any token ending in a known extension, which couldn't tell
// a provenance citation from a filename that IS the answer: it deleted real
// content like "train.csv, test.csv" → ", " and "Edit package.json" → "Edit",
// exactly in the data/software/research domains the Step 235 repositioning
// targets. The model's actual leak patterns are parenthetical or quoted, so
// the two passes above cover the §6 cleanup intent without mangling answers.

/**
 * Removes filenames the model emitted as CITATIONS in its prose — i.e.
 * wrapped in parentheses/brackets ("(see report_2026.pdf, §4.1)") or in
 * quotes ("„report_2026.pdf""), plus the wrapper around them — then tidies
 * the leftover punctuation.
 *
 * Step 325 — deliberately does NOT touch BARE filenames in running prose. A
 * bare token like `train.csv` or `package.json` is frequently the ANSWER
 * (datasets, config files, attachments), not a provenance leak, and there's
 * no syntactic way to tell the two apart. Stripping them unconditionally
 * (the original Step 317 behaviour) deleted substantive content; the
 * citation-shaped passes below catch the model's actual leak patterns
 * without that collateral damage.
 *
 * Idempotent and cheap (a couple of regex passes on a short answer). Safe on
 * empty input.
 */
export function stripInlineFilenames(value: string | null | undefined): string {
  if (!value) return "";
  let s = value;
  s = s.replace(PAREN_CITATION_RE, "");
  s = s.replace(QUOTED_FILENAME_RE, "");
  // Tidy the artifacts a removal can leave behind.
  s = s
    .replace(/[“„"'`]\s*[”’"'`]/g, "") // empty quote pairs
    .replace(/\(\s*\)/g, "") // empty parens
    .replace(/\[\s*\]/g, "") // empty brackets
    .replace(/[ \t]{2,}/g, " ") // collapse runs of spaces
    .replace(/\s+([,.;:)])/g, "$1") // space before closing punctuation
    .replace(/([(])\s+/g, "$1") // space after opening paren
    .replace(/([,;:])\s*([,.;:])/g, "$2") // doubled punctuation
    .replace(/[ \t]+\n/g, "\n") // trailing spaces on a line
    .replace(/\n{3,}/g, "\n\n"); // collapse blank-line runs
  return s.trim();
}
