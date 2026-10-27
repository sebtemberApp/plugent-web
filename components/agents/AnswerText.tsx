import { Fragment } from "react";

/**
 * The Ask agent's answer as light prose: paragraphs, "- " lines as a list, **bold**, and
 * each [n] citation as a small chip matching its source card. Nothing else is parsed, and
 * nothing is rendered as HTML.
 */
export function AnswerText({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      blocks.push({ list: false, lines: [] });
      continue;
    }
    const item = /^[-•*]\s+(.*)$/.exec(line);
    const last = blocks.at(-1);
    if (item) {
      if (last?.list) last.lines.push(item[1] ?? "");
      else blocks.push({ list: true, lines: [item[1] ?? ""] });
    } else if (last && !last.list && last.lines.length > 0) {
      last.lines.push(line);
    } else {
      blocks.push({ list: false, lines: [line] });
    }
  }

  return (
    <div className="prose-answer flex flex-col gap-2.5 text-[16px] leading-[26px]">
      {blocks
        .filter((b) => b.lines.length > 0)
        .map((b, i) =>
          b.list ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks are derived once per answer
            <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
              {b.lines.map((l, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: as above
                <li key={j}>
                  <Inline text={l} />
                </li>
              ))}
            </ul>
          ) : (
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
          ),
        )}
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
