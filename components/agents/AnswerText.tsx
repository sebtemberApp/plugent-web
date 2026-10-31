import { Fragment, type ReactNode } from "react";

/**
 * An agent's answer as Markdown, the subset sebtember's chat prompt asks for: `#`–`####`
 * headings, paragraphs, `-` lists (an indented line nests under the item above it), `1.`
 * lists, tables, `>` quotes, `---` rules, **bold**, *italic*, `code`, and each [n] citation as
 * a small chip matching its source card (older answers carry them). Specification's
 * "General best-practice …" note is set quieter, so the reader sees where the documents end.
 * Nothing is rendered as HTML.
 */
type ListItem = { text: string; sub: string[] };
type Block =
  | { type: "p"; lines: string[] }
  | { type: "h"; level: 2 | 3 | 4; text: string }
  | { type: "note"; text: string }
  | { type: "quote"; lines: string[] }
  | { type: "hr" }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { type: "table"; head: string[]; align: ("left" | "right" | "center")[]; rows: string[][] };

const NOTE = /^general best[- ]practice\b/i;
const BULLET = /^[-•*]\s+(.*)$/;
const NUMBERED = /^(\d+)[.)]\s+(.*)$/;
const TABLE_RULE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n] ?? "";
    const line = raw.trim();
    const last = blocks.at(-1);
    if (!line) {
      blocks.push({ type: "p", lines: [] });
      continue;
    }
    // A table: a row of cells, then a rule row under it.
    if (line.includes("|") && TABLE_RULE.test((lines[n + 1] ?? "").trim())) {
      const head = cells(line);
      const align = cells(lines[n + 1] ?? "").map((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left",
      ) as ("left" | "right" | "center")[];
      const rows: string[][] = [];
      n += 2;
      while (n < lines.length && (lines[n] ?? "").includes("|") && (lines[n] ?? "").trim()) {
        rows.push(cells(lines[n] ?? ""));
        n++;
      }
      n--;
      blocks.push({ type: "table", head, align, rows });
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(Math.max(heading[1]?.length ?? 2, 2), 4) as 2 | 3 | 4;
      blocks.push({ type: "h", level, text: heading[2] ?? "" });
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(line)) {
      blocks.push({ type: "hr" });
      continue;
    }
    if (line.startsWith(">")) {
      const body = line.replace(/^>\s?/, "");
      if (last?.type === "quote") last.lines.push(body);
      else blocks.push({ type: "quote", lines: [body] });
      continue;
    }
    const indented = /^\s{2,}/.test(raw);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = !bullet;
      const body = (bullet ? bullet[1] : numbered?.[2]) ?? "";
      if (indented && last?.type === "list" && last.items.length > 0) {
        last.items.at(-1)?.sub.push(body);
      } else if (last?.type === "list" && last.ordered === ordered) {
        last.items.push({ text: body, sub: [] });
      } else {
        blocks.push({
          type: "list",
          ordered,
          start: numbered ? Number(numbered[1]) : 1,
          items: [{ text: body, sub: [] }],
        });
      }
      continue;
    }
    // A wrapped line under a list item belongs to it.
    if (indented && last?.type === "list" && last.items.length > 0) {
      const item = last.items.at(-1);
      if (item) item.text = `${item.text} ${line}`;
      continue;
    }
    if (NOTE.test(line)) {
      blocks.push({ type: "note", text: line });
    } else if (last?.type === "p" && last.lines.length > 0) {
      last.lines.push(line);
    } else {
      blocks.push({ type: "p", lines: [line] });
    }
  }
  return blocks.filter((b) => b.type !== "p" || b.lines.length > 0);
}

const HEADING = {
  2: "mt-3 text-[19px] leading-[26px] font-bold tracking-[-0.01em] first:mt-0",
  3: "mt-2 text-[16px] leading-6 font-bold first:mt-0",
  4: "mt-1 text-[15px] leading-6 font-semibold first:mt-0",
} as const;

export function AnswerText({ text }: { text: string }) {
  return (
    <div className="prose-answer flex flex-col gap-2.5 text-[16px] leading-[26px]">
      {parseAnswer(text).map((b, i) => {
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are derived once per answer
        const key = i;
        switch (b.type) {
          case "h": {
            const Heading = (["h2", "h3", "h4"] as const)[b.level - 2] ?? "h3";
            return (
              <Heading key={key} className={HEADING[b.level]}>
                <Inline text={b.text} />
              </Heading>
            );
          }
          case "note":
            return (
              <p key={key} className="mt-1 text-[14px] leading-[22px] text-ink2">
                {b.text}
              </p>
            );
          case "hr":
            return <hr key={key} className="my-1 border-hair" />;
          case "quote":
            return (
              <blockquote key={key} className="border-hair border-l-2 pl-3.5 text-ink2">
                <Lines lines={b.lines} />
              </blockquote>
            );
          case "list": {
            const List = b.ordered ? "ol" : "ul";
            return (
              <List
                key={key}
                start={b.ordered && b.start !== 1 ? b.start : undefined}
                className={`flex flex-col gap-1 pl-5 ${b.ordered ? "list-decimal" : "list-disc"} marker:text-ink2`}
              >
                {b.items.map((item, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: as above
                  <li key={j} className="pl-0.5">
                    <Inline text={item.text} />
                    {item.sub.length > 0 && (
                      <ul className="mt-1 flex list-[circle] flex-col gap-0.5 pl-5">
                        {item.sub.map((sub, k) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: as above
                          <li key={k}>
                            <Inline text={sub} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </List>
            );
          }
          case "table":
            return (
              <div key={key} className="-mx-1 overflow-x-auto px-1">
                <table className="w-full border-collapse text-[14px] leading-5">
                  <thead>
                    <tr>
                      {b.head.map((h, j) => (
                        <th
                          // biome-ignore lint/suspicious/noArrayIndexKey: as above
                          key={j}
                          className="border-hair border-b px-2.5 py-2 text-left font-semibold whitespace-nowrap text-ink2 first:pl-0"
                          style={{ textAlign: b.align[j] }}
                        >
                          <Inline text={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: as above
                      <tr key={r} className="border-hair border-b-[0.5px] last:border-b-0">
                        {b.head.map((_, j) => (
                          <td
                            // biome-ignore lint/suspicious/noArrayIndexKey: as above
                            key={j}
                            className="px-2.5 py-2 align-top first:pl-0"
                            style={{ textAlign: b.align[j] }}
                          >
                            <Inline text={row[j] ?? ""} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return (
              <p key={key}>
                <Lines lines={b.lines} />
              </p>
            );
        }
      })}
    </div>
  );
}

function Lines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((l, j) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines of one fixed string
        <Fragment key={j}>
          {j > 0 && <br />}
          <Inline text={l} />
        </Fragment>
      ))}
    </>
  );
}

// No `_italic_`: file and model names carry underscores.
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[\d+\]|\*[^*\s][^*]*\*)/g;

function Inline({ text }: { text: string }): ReactNode {
  const parts = text.split(INLINE).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        const cite = /^\[(\d+)\]$/.exec(part);
        if (cite) {
          return (
            <sup
              // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string
              key={i}
              className="mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-0.5 items-center justify-center rounded-[6px] bg-fill2 px-1 align-baseline text-[12px] font-semibold text-ink2"
            >
              {cite[1]}
            </sup>
          );
        }
        if (/^\*\*.+\*\*$/.test(part)) {
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string
            <code key={i} className="rounded-[5px] bg-fill1 px-1 py-px text-[14px]">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (/^\*.+\*$/.test(part) && part.length > 2) {
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}
