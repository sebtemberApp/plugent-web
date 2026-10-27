"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
import { AgentIcon } from "@/components/ui/AgentIcon";
import { type AgentId, agentById } from "@/lib/agents/registry";

type Slide = {
  id: AgentId;
  headline: string;
  steps: [string, string, string];
  gain: string;
};

const SLIDES: [Slide, ...Slide[]] = [
  {
    id: "chat",
    headline: "Ask your documents like you'd ask a colleague",
    steps: [
      "Type or say your question.",
      "Chat finds the answer in your manuals, contracts and price lists.",
      "You get a short answer with the files it came from.",
    ],
    gain: "No more digging through folders. Every answer shows where it came from, so you can check it in a click.",
  },
  {
    id: "troubleshooting",
    headline: "Fix a fault one step at a time",
    steps: [
      "Describe the problem, or send a photo of the error.",
      "The agent gives you one step from your service manuals.",
      "Tell it what happened and it picks the next step.",
    ],
    gain: "Your team fixes more on the first visit, guided by your own procedures instead of guesswork.",
  },
  {
    id: "specification",
    headline: "A design-stage specification in minutes",
    steps: [
      "Name the device or material.",
      "The agent reads your datasheets and manuals.",
      "You get parameters, installation and operation notes.",
    ],
    gain: "Hours of copying from datasheets become a few minutes of review.",
  },
  {
    id: "quotation",
    headline: "Tender text ready to send to suppliers",
    steps: [
      "Name what you need to buy.",
      "The agent drafts a brand-neutral specification.",
      "Review it and send it out.",
    ],
    gain: "Fair, comparable offers, because every supplier answers the same specification.",
  },
  {
    id: "pricing",
    headline: "Price a whole materials list at once",
    steps: [
      "Upload the tender or bill of materials.",
      "The agent matches each line to your price lists.",
      "Check the matches and download the priced sheet.",
    ],
    gain: "A quote that took a day takes an hour. Lines it can't price are marked, never invented.",
  },
];

/** The agents, one slide each: how it works and what you gain, beside a picture of it. */
export function AgentCarousel() {
  const [index, setIndex] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const slide = SLIDES[index] ?? SLIDES[0];
  const agent = agentById(slide.id);
  const go = (i: number, focus = false) => {
    const next = (i + SLIDES.length) % SLIDES.length;
    setIndex(next);
    if (focus) tabs.current[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-5">
      <div
        role="tablist"
        aria-label="Agents"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(index + 1, true);
          if (e.key === "ArrowLeft") go(index - 1, true);
        }}
      >
        {SLIDES.map((s, i) => {
          const a = agentById(s.id);
          const on = i === index;
          return (
            <button
              key={s.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${s.id}`}
              aria-selected={on}
              aria-controls="agent-slide"
              tabIndex={on ? 0 : -1}
              onClick={() => go(i)}
              className={`flex h-11 shrink-0 items-center gap-2 rounded-full pr-4 pl-1.5 text-[15px] font-semibold ${
                on ? "bg-card text-ink shadow-card" : "text-ink2 hover:bg-fill1"
              }`}
            >
              <AgentIcon agent={a} />
              {a.name}
            </button>
          );
        })}
      </div>

      <div
        id="agent-slide"
        role="tabpanel"
        aria-labelledby={`tab-${slide.id}`}
        className="grid overflow-hidden rounded-card bg-card shadow-card lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"
      >
        <div className="flex flex-col gap-5 p-6 sm:p-8">
          <AgentIcon agent={agent} size="card" />
          <h3 className="text-[26px] leading-[32px] font-bold tracking-[-0.015em]">
            {slide.headline}
          </h3>
          <ol className="flex flex-col gap-3">
            {slide.steps.map((step, i) => (
              <li key={step} className="flex gap-3 text-[16px] leading-[24px]">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-fill2 text-[13px] font-bold">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <div className="rounded-control bg-sel p-4">
            <p className="text-[13px] font-semibold text-act">What you gain</p>
            <p className="mt-1 text-[16px] leading-[24px]">{slide.gain}</p>
          </div>
          <div className="mt-auto flex gap-2">
            <button
              type="button"
              aria-label="Previous agent"
              onClick={() => go(index - 1)}
              className="flex size-10 items-center justify-center rounded-full bg-fill1 hover:bg-fill2"
            >
              <ChevronLeft aria-hidden size={20} />
            </button>
            <button
              type="button"
              aria-label="Next agent"
              onClick={() => go(index + 1)}
              className="flex size-10 items-center justify-center rounded-full bg-fill1 hover:bg-fill2"
            >
              <ChevronRight aria-hidden size={20} />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-center bg-fill1 p-5 sm:p-8">
          <Picture id={slide.id} />
        </div>
      </div>
    </div>
  );
}

/** A picture of the agent at work: the real screen for Chat, a sketch for the rest. */
function Picture({ id }: { id: AgentId }) {
  if (id === "chat") {
    return (
      <Image
        src="/marketing/chat-answer.png"
        alt="A Chat answer with its prices and the two source files it came from"
        width={1512}
        height={786}
        sizes="(min-width: 1024px) 600px, 100vw"
        className="w-full rounded-control shadow-pop"
      />
    );
  }
  return (
    <div
      aria-hidden
      className="w-full max-w-[460px] rounded-control bg-card p-5 text-[14px] shadow-pop"
    >
      {id === "troubleshooting" && <Troubleshooting />}
      {id === "specification" && <Specification />}
      {id === "quotation" && <Quotation />}
      {id === "pricing" && <Pricing />}
    </div>
  );
}

function Troubleshooting() {
  return (
    <div className="flex flex-col gap-3">
      <div className="self-end rounded-[16px] bg-fill2 px-3 py-2">
        The outdoor unit shows E02 and stops after two minutes.
      </div>
      <div className="flex items-center gap-2 rounded-chip bg-fill1 px-3 py-2 text-ink2">
        <span className="flex size-5 items-center justify-center rounded-full bg-ok text-[11px] font-bold text-white">
          1
        </span>
        Check the water flow · didn't help
      </div>
      <div className="flex flex-col gap-2 rounded-chip border-[0.5px] border-hair p-3">
        <span className="font-bold">Step 2 · Check the flow sensor wiring</span>
        <span className="text-ink2">
          Find connector X3 on the main board and check the plug sits fully home.
        </span>
        <span className="flex flex-wrap gap-2 pt-1">
          <span className="rounded-full bg-act px-3 py-1 font-semibold text-white">Fixed it</span>
          <span className="rounded-full bg-fill2 px-3 py-1 font-semibold">Didn't help</span>
        </span>
      </div>
    </div>
  );
}

function Specification() {
  const rows = [
    ["Heating capacity", "12 kW"],
    ["SCOP (W35)", "4.6"],
    ["Max flow temperature", "65 °C"],
    ["Sound power", "58 dB(A)"],
  ];
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[16px] font-bold">12 kW air-to-water heat pump</span>
      <span className="font-semibold text-ink2">Parameters</span>
      <div className="flex flex-col">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between border-hair border-b-[0.5px] py-1.5">
            <span className="text-ink2">{k}</span>
            <span className="font-semibold">{v}</span>
          </div>
        ))}
      </div>
      <span className="font-semibold text-ink2">Installation</span>
      <span>Mount on a level base with 0.5 m free behind and 1.5 m in front.</span>
    </div>
  );
}

function Quotation() {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[16px] font-bold">Request for quotation</span>
      <span className="text-ink2">Ventilation unit, 800 m³/h</span>
      <ol className="flex flex-col gap-2">
        {[
          "Air flow at least 800 m³/h at 150 Pa",
          "Heat recovery efficiency at least 85%",
          "Filters ePM1 55% supply, ePM10 50% extract",
          "Any brand meeting these requirements",
        ].map((t, i) => (
          <li key={t} className="flex gap-2">
            <span className="font-bold text-a-quo">{i + 1}.</span>
            {t}
          </li>
        ))}
      </ol>
      <span className="self-start rounded-full bg-fill2 px-3 py-1 font-semibold">
        Copy to email
      </span>
    </div>
  );
}

function Pricing() {
  const rows = [
    ["Heat pump 12 kW", "2 pcs", "€4,180.00"],
    ["Buffer tank 200 l", "2 pcs", "€612.00"],
    ["Ball valve DN25", "8 pcs", "€96.80"],
    ["Expansion vessel 35 l", "2 pcs", "No price"],
  ];
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[16px] font-bold">Kaunas school, materials list</span>
      <div className="flex flex-col">
        {rows.map(([n, q, p]) => (
          <div
            key={n}
            className="grid grid-cols-[1fr_auto_auto] gap-3 border-hair border-b-[0.5px] py-1.5"
          >
            <span>{n}</span>
            <span className="text-ink2">{q}</span>
            <span className={p === "No price" ? "font-semibold text-warn" : "font-semibold"}>
              {p}
            </span>
          </div>
        ))}
      </div>
      <span className="text-ink2">3 of 4 lines priced · total €4,888.80</span>
    </div>
  );
}
