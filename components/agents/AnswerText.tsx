import { Fragment } from "react";

/**
 * An agent's answer as light Markdown: "## " / "### " headings, paragraphs, "- " lines as a
 * list (an indented "- " line nests under the item above it), **bold**, and each [n]
 * citation as a small chip matching its source card. Specification's "General
 * best-practice …" note is set quieter, so the reader sees where the documents end.
 * Nothing else is parsed, and nothing is rendered as HTML.
 */
type Block =
  | { type: "p"; lines: string[] }
  | { type: "h"; level: 2 | 3; text: string }
  | { type: "note"; text: string }
  | { type: "list"; items: { text: string; sub: string[] }[] };

const NOTE = /^general best[- ]practice\b/i;

export function AnswerText({ text }: { text: string }) {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const last = blocks.at(-1);
    if (!line) {
      blocks.push({ type: "p", lines: [] });
      continue;
    }
    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "h", level: heading[1] === "##" ? 2 : 3, text: heading[2] ?? "" });
      continue;
    }
    const item = /^[-•*]\s+(.*)$/.exec(line);
    if (item) {
      const body = item[1] ?? "";
      const nested = /^\s{2,}/.test(raw) && last?.type === "list" && last.items.length > 0;
      if (nested) last.items.at(-1)?.sub.push(body);
      else if (last?.type === "list") last.items.push({ text: body, sub: [] });
      else blocks.push({ type: "list", items: [{ text: body, sub: [] }] });
    } else if (NOTE.test(line)) {
      blocks.push({ type: "note", text: line });
    } else if (last?.type === "p" && last.lines.length > 0) {
      last.lines.push(line);
    } else {
      blocks.push({ type: "p", lines: [line] });
    }
  }

  return (
    <div className="prose-answer flex flex-col gap-2.5 text-[16px] leading-[26px]">
      {blocks
        .filter((b) => b.type !== "p" || b.lines.length > 0)
        .map((b, i) => {
          if (b.type === "h") {
            const Heading = b.level === 2 ? "h2" : "h3";
            return (
              <Heading
                // biome-ignore lint/suspicious/noArrayIndexKey: blocks are derived once per answer
                key={i}
                className={
                  b.level === 2
                    ? "mt-2 text-[18px] leading-6 font-bold tracking-[-0.01em] first:mt-0"
                    : "mt-1 text-[16px] leading-6 font-bold"
                }
              >
                <Inline text={b.text} />
              </Heading>
            );
          }
          if (b.type === "note") {
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: as above
              <p key={i} className="mt-1 text-[14px] leading-[22px] text-ink2">
                {b.text}
              </p>
            );
          }
          if (b.type === "list") {
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: as above
              <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
                {b.items.map((item, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: as above
                  <li key={j}>
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
              </ul>
            );
          }
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: as above
            <p key={i}>
              {b.lines.map((l, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: as above
                <Fragment key={j}>
                  {j > 0 && <br />}
                  <Inline text={l} />
                </Fragment>
              ))}
            </p>
          );
        })}
    </div>
  );
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g).filter(Boolean);
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
        if (part.startsWith("**") && part.endsWith("**")) {
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}
