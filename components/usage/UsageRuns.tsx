"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { ChargeUsage } from "@/lib/sebtember/products";

export interface UsageRunView {
  id: string;
  /** null for a deleted run: its charges stay, there is nothing to open. */
  href: string | null;
  title: string;
  /** Agent and date, already spelled by the server. */
  meta: string;
  plg: number;
  seb: number;
  unsplit: number;
  total: number;
  charges: Array<{
    line: string;
    by: "plugent" | "sebtember";
    what: string;
    tokens: number;
    usage: ChargeUsage[];
  }>;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const NUM = "shrink-0 text-right tabular-nums";

/** The period's runs; a run opens to the charges it was made of and the models behind each. */
export function UsageRuns({ runs }: { runs: UsageRunView[] }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="overflow-hidden rounded-list bg-card shadow-card">
      <div className="flex items-center gap-4 bg-fill1 px-4 py-2.5 text-[12px] font-semibold tracking-[0.02em] text-ink2">
        <span className="w-[18px] shrink-0" />
        <span className="flex-1">Run</span>
        <span className={`${NUM} hidden w-[92px] min-[600px]:block`}>Agent work</span>
        <span className={`${NUM} hidden w-[92px] min-[600px]:block`}>Data</span>
        <span className={`${NUM} w-[92px]`}>Total</span>
      </div>
      {runs.map((r) => {
        const isOpen = open.has(r.id);
        return (
          <div key={r.id} className={`border-hair border-t-[0.5px] ${isOpen ? "bg-fill1/60" : ""}`}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => toggle(r.id)}
              className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-fill1"
            >
              <ChevronRight
                aria-hidden
                size={18}
                className={`shrink-0 text-ink2 transition-transform ${isOpen ? "rotate-90" : ""}`}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-semibold">{r.title}</span>
                <span className="text-[13px] text-ink2">{r.meta}</span>
              </span>
              <span className={`${NUM} hidden w-[92px] text-[14px] min-[600px]:block`}>
                {r.plg + r.seb > 0 ? fmt(r.plg) : "—"}
              </span>
              <span className={`${NUM} hidden w-[92px] text-[14px] min-[600px]:block`}>
                {r.plg + r.seb > 0 ? fmt(r.seb) : "—"}
              </span>
              <span className={`${NUM} w-[92px] text-[15px] font-semibold`}>{fmt(r.total)} tk</span>
            </button>
            {isOpen && (
              <div className="flex flex-col gap-2 pr-4 pb-4 pl-4 min-[600px]:pl-[52px]">
                {r.charges.map((c) => (
                  <div
                    key={c.line}
                    className="flex flex-col gap-2 rounded-control bg-card px-3.5 py-3 shadow-card"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`size-2.5 shrink-0 rounded-[3px] ${c.by === "plugent" ? "bg-u-plg" : "bg-u-seb"}`}
                      />
                      <span className="flex-1 text-[14px] font-semibold">
                        {c.what}{" "}
                        <span className="font-medium text-ink2">
                          · {c.by === "plugent" ? "Plugent" : "Sebtember"}
                        </span>
                      </span>
                      <span className="text-[14px] font-semibold tabular-nums">
                        {fmt(c.tokens)} tk
                      </span>
                    </div>
                    {c.usage.map((m, i) => (
                      <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: one row per model call, in order
                        key={i}
                        className="flex flex-wrap gap-x-[18px] gap-y-1 pl-5 text-[13px] text-ink2 tabular-nums"
                      >
                        <span className="basis-full font-mono text-[12.5px] text-ink min-[600px]:basis-auto min-[600px]:min-w-[190px]">
                          {m.model}
                        </span>
                        <span>Input {fmt(m.input)}</span>
                        <span>Output {fmt(m.output)}</span>
                        {m.reasoning ? <span>Reasoning {fmt(m.reasoning)}</span> : null}
                        {m.cached ? <span>Cached {fmt(m.cached)}</span> : null}
                      </div>
                    ))}
                    {c.usage.length === 0 && (
                      <p className="pl-5 text-[13px] text-ink2">
                        No model counts were sent with this charge.
                      </p>
                    )}
                  </div>
                ))}
                {r.unsplit > 0 && (
                  <div className="flex items-center gap-2.5 rounded-control bg-card px-3.5 py-3 shadow-card">
                    <span className="size-2.5 shrink-0 rounded-[3px] bg-fill2" />
                    <span className="flex-1 text-[14px] font-semibold">
                      Earlier charges <span className="font-medium text-ink2">· not itemised</span>
                    </span>
                    <span className="text-[14px] font-semibold tabular-nums">
                      {fmt(r.unsplit)} tk
                    </span>
                  </div>
                )}
                {r.href && (
                  <Link
                    href={r.href}
                    className="self-start pl-1 text-[13px] font-semibold text-link"
                  >
                    Open the run
                  </Link>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
