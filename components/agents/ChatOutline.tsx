"use client";

/**
 * The conversation's outline, as in Sebtember chat: one row per answer, titled by the
 * answer's first Markdown heading (or its first line), that scrolls to that question.
 * It floats in the left gutter beside the 820px thread and shows only when the gutter
 * fits it (a container query on the thread's wrapper), so it never squeezes the answers.
 */

/** Longer titles are cut with "…", as in Sebtember. */
const TITLE_MAX = 30;

export type OutlineEntry = { id: string; title: string };

/** The answer's first # / ## / ### heading, else its first non-empty line, without
 *  Markdown marks, citations or emoji. */
export function outlineTitle(answer: string): string {
  const lines = answer.split("\n");
  let raw = "";
  for (const line of lines) {
    const h = line.match(/^\s{0,3}#{1,3}\s+(.+?)\s*#*\s*$/);
    if (h?.[1]) {
      raw = h[1];
      break;
    }
  }
  if (!raw) raw = lines.find((l) => l.trim())?.trim() ?? "";
  raw = raw
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\d+\]/g, "")
    .replace(/[*_`~]/g, "")
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u{FE0F}|\u{200D}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return raw.length > TITLE_MAX ? `${raw.slice(0, TITLE_MAX).trimEnd()}…` : raw;
}

export function turnAnchor(id: string): string {
  return `turn-${id}`;
}

export function ChatOutline({ entries }: { entries: OutlineEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <nav
      aria-label="Conversation outline"
      className="absolute inset-y-0 left-0 hidden w-56 pt-7 pl-4 @min-[1210px]:block"
    >
      <ul className="sticky top-6 flex max-h-[calc(100dvh-48px)] flex-col gap-0.5 overflow-y-auto">
        {entries.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              title={e.title}
              onClick={() =>
                document
                  .getElementById(turnAnchor(e.id))
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="flex w-full rounded-chip px-2.5 py-1.5 text-left text-[13px] text-ink2 hover:bg-fill1 hover:text-ink"
            >
              <span className="min-w-0 truncate">{e.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
