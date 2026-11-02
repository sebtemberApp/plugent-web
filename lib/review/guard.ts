/**
 * The proposal's mechanical guard — the last check before the Chat review's proposal leaves Plugent's
 * Firestore for a PUBLIC repository (a PR body, `chat-prompt.ts`, `chat-behavior-cases.json`).
 * `leakRefusal` is the evidence half alone, which the Pricing review's proposal passes too.
 *
 * The proposer is TOLD to write in general terms with invented products and numbers; this module does
 * not trust that. It refuses a proposal that:
 *   - shares a run of `SHINGLE_WORDS` words, a number of 3+ digits, or a file / catalogue name with the
 *     evidence it was built from (questions, answers, passages, feedback, the judge's gaps) — text the
 *     current prompt itself holds does not count, since an edit legitimately quotes it;
 *   - would break out of `SYSTEM_INSTRUCTION_GPT`'s backtick template literal (`` ` ``, `${`, `\`): a
 *     `${process.env.X}` would put a server secret into the production prompt and run code at import;
 *   - names an `edit.find` that is not in the prompt EXACTLY ONCE, or replaces text with nothing.
 *
 * ⚠️ The evidence is untrusted user text and reached the proposal through two models, so a refusal
 * never quotes what matched: the reason names only the kind of match.
 */
import { SYSTEM_INSTRUCTION_GPT } from "@/lib/agents/chat-prompt";
import type { Conversation, Gap, Proposal } from "@/lib/review/chat-review";

const SHINGLE_WORDS = 6;

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

function shingles(s: string): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE_WORDS <= w.length; i++)
    out.add(w.slice(i, i + SHINGLE_WORDS).join(" "));
  return out;
}

/** Numbers of 3+ digits, separators dropped (`1 249,00` and `1249.00` are the same figure). */
function numbers(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(/\d[\d.,   ]*\d|\d/gu)) {
    // Only a DECIMAL tail of zeros goes (`,00`, `.0`): `1600` and `1,000` stay whole.
    const digits = m[0].replace(/[.,]0{1,2}$/, "").replace(/\D/g, "");
    if (digits.length >= 3) out.add(digits);
  }
  return out;
}

/** Every string the proposal publishes. */
function publishedText(p: Proposal): string {
  return [p.title, p.problem, p.edit.replace, p.expectedEffect, JSON.stringify(p.cases ?? [])]
    .map((x) => String(x ?? ""))
    .join("\n");
}

/** The evidence the proposal was built from, as text. */
export function evidenceText(
  conversations: Conversation[],
  gaps: Gap[],
): {
  text: string;
  names: string[];
} {
  const parts: string[] = [];
  const names = new Set<string>();
  for (const c of conversations) {
    parts.push(...c.feedback);
    for (const t of c.turns) {
      parts.push(t.question, t.answer);
      for (const p of t.trace?.passages ?? []) {
        parts.push(p.text ?? "");
        for (const n of [p.file_name, p.catalogue_name, p.collection_name, p.section])
          if (typeof n === "string" && n.trim().length >= 5) names.add(n.trim().toLowerCase());
      }
      for (const f of t.trace?.wholeFiles ?? [])
        if (f.trim().length >= 5) names.add(f.trim().toLowerCase());
    }
  }
  for (const g of gaps) parts.push(g.what, g.evidence, g.fix);
  return { text: parts.join("\n"), names: [...names] };
}

/** null when the proposal may be published; else why not (never the matched text). */
export function proposalRefusal(
  p: Proposal,
  evidence: { text: string; names: string[] },
  prompt: string = SYSTEM_INSTRUCTION_GPT,
): string | null {
  for (const s of [p.edit.find, p.edit.replace]) {
    if (/[`\\]|\$\{/.test(s))
      return "the edit holds a backtick, a backslash or ${ — it would break the prompt's template literal";
  }
  if (!p.edit.replace.trim()) return "the edit replaces text with nothing";
  if (p.edit.find) {
    const first = prompt.indexOf(p.edit.find);
    if (first < 0) return "edit.find is not in the prompt";
    if (prompt.indexOf(p.edit.find, first + 1) >= 0)
      return "edit.find occurs more than once in the prompt";
  }

  return leakRefusal(publishedText(p), evidence, prompt, "conversations");
}

/**
 * null when `out` carries nothing of the evidence; else which kind of thing it carries. Text in
 * `allowed` (what the published file already holds, e.g. the prompt an edit quotes) does not count.
 * Shared by the Chat and Pricing reviews.
 */
export function leakRefusal(
  out: string,
  evidence: { text: string; names: string[] },
  allowed: string,
  what: string,
): string | null {
  const outLower = out.toLowerCase();
  if (evidence.names.some((n) => outLower.includes(n)))
    return `it names a file, catalogue or code from the reviewed ${what}`;

  const allowedShingles = shingles(allowed);
  const evidenceShingles = shingles(evidence.text);
  for (const s of shingles(out))
    if (evidenceShingles.has(s) && !allowedShingles.has(s))
      return `it repeats ${SHINGLE_WORDS}+ words of the reviewed ${what}`;

  const allowedNumbers = numbers(allowed);
  const evidenceNumbers = numbers(evidence.text);
  for (const n of numbers(out))
    if (evidenceNumbers.has(n) && !allowedNumbers.has(n))
      return `it carries a number from the reviewed ${what}`;

  return null;
}
