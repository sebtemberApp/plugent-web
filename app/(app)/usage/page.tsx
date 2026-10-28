import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AgentIcon } from "@/components/ui/AgentIcon";
import { PageHeader } from "@/components/ui/PageHeader";
import { UsageRuns, type UsageRunView } from "@/components/usage/UsageRuns";
import { AGENTS, agentById } from "@/lib/agents/registry";
import { getSessionUser } from "@/lib/auth/session";
import { readUsage } from "@/lib/runs";
import { getBalance } from "@/lib/sebtember/products";

export const dynamic = "force-dynamic";

const PAGE =
  "mx-auto flex w-full max-w-[920px] flex-col gap-8 px-4 py-8 min-[600px]:px-8 min-[600px]:py-10";

const PERIODS = [
  { id: "month", label: "This month" },
  { id: "last", label: "Last month" },
  { id: "all", label: "All time" },
] as const;
type PeriodId = (typeof PERIODS)[number]["id"];

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fmt = (n: number) => n.toLocaleString("en-US");

/** A period's window in UTC months, and the first tile's label. */
function windowOf(period: PeriodId, now: Date) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (period === "all") return { since: null, until: null, label: "Used in total" };
  if (period === "last") {
    const since = Date.UTC(y, m - 1, 1);
    return { since, until: Date.UTC(y, m, 1), label: `Used in ${MONTH.format(since)}` };
  }
  const since = Date.UTC(y, m, 1);
  return { since, until: null, label: `Used in ${MONTH.format(since)}` };
}

/**
 * What the user's agents took from their Sebtember wallet: Plugent's own model work and what
 * Sebtember charged (knowledge searches at cost, the Pricing engine), run by run, with the
 * models behind every charge. Read from the charges each turn keeps; nothing is estimated.
 */
export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const { period: asked } = await searchParams;
  const period: PeriodId = PERIODS.some((p) => p.id === asked) ? (asked as PeriodId) : "month";
  const win = windowOf(period, new Date());

  const [usage, wallet] = await Promise.all([
    readUsage(user.uid, win.since, win.until).catch((err) => {
      console.error("[usage] read failed", err);
      return null;
    }),
    getBalance(user.uid).catch(() => null),
  ]);
  const origin = process.env.SEBTEMBER_API_ORIGIN?.trim();
  const topUp = origin ? new URL("/usage", origin).toString() : null;

  if (!usage) {
    return (
      <main className={PAGE}>
        <Header period={period} />
        <div className="rounded-card bg-card p-6 shadow-card">
          <p className="text-[17px] leading-[26px]">
            Your usage could not be read just now. Try again in a moment.
          </p>
        </div>
      </main>
    );
  }

  const runs: UsageRunView[] = usage.runs.map((r) => {
    const agent = agentById(r.agent);
    const plg = r.charges.filter((c) => c.by === "plugent").reduce((s, c) => s + c.tokens, 0);
    const seb = r.charges.filter((c) => c.by === "sebtember").reduce((s, c) => s + c.tokens, 0);
    return {
      id: r.id,
      href: `${agent.href}/${r.id}`,
      title: r.title,
      meta: `${agent.name} · ${DAY.format(r.lastAt)}`,
      plg,
      seb,
      unsplit: r.unsplit,
      total: plg + seb + r.unsplit,
      charges: r.charges.map((c) => ({
        line: c.line,
        by: c.by,
        what: c.what,
        tokens: c.tokens,
        usage: c.usage ?? [],
      })),
    };
  });
  const sum = (k: "plg" | "seb" | "unsplit" | "total") => runs.reduce((s, r) => s + r[k], 0);
  const byAgent = AGENTS.map((a) => {
    const mine = runs.filter((r) => usage.runs.find((u) => u.id === r.id)?.agent === a.id);
    return {
      agent: a,
      runs: mine.length,
      plg: mine.reduce((s, r) => s + r.plg, 0),
      seb: mine.reduce((s, r) => s + r.seb, 0),
      unsplit: mine.reduce((s, r) => s + r.unsplit, 0),
      total: mine.reduce((s, r) => s + r.total, 0),
    };
  }).filter((a) => a.total > 0);
  const widest = Math.max(1, ...byAgent.map((a) => a.total));

  return (
    <main className={PAGE}>
      <Header period={period} />

      <section
        aria-label="Totals"
        className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3"
      >
        <Tile label={win.label} value={sum("total")} note={runsLabel(runs.length)} />
        <Tile
          label="Agent work on Plugent"
          swatch="bg-u-plg"
          value={sum("plg")}
          note="Answers, drafts and steps"
        />
        <Tile
          label="Data served by Sebtember"
          swatch="bg-u-seb"
          value={sum("seb")}
          note="Knowledge searches at cost, and Pricing"
        />
        <Tile
          label="Wallet balance"
          value={wallet?.balance ?? null}
          note={
            topUp ? (
              <a
                href={topUp}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1 font-semibold text-link"
              >
                Top up in Sebtember
                <ArrowUpRight aria-hidden size={13} strokeWidth={2.2} />
              </a>
            ) : null
          }
        />
      </section>

      {runs.length === 0 ? (
        <div className="rounded-card bg-card p-6 shadow-card">
          <p className="text-[17px] leading-[26px]">
            No agent used tokens in this period.{" "}
            <Link href="/home" className="font-semibold text-link">
              Start a run
            </Link>
          </p>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-[22px] font-bold">By agent</h2>
            <ul className="overflow-hidden rounded-list bg-card shadow-card">
              {byAgent.map((a, i) => (
                <li
                  key={a.agent.id}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 ${i > 0 ? "border-hair border-t-[0.5px]" : ""}`}
                >
                  <span className="flex w-[190px] shrink-0 items-center gap-3">
                    <AgentIcon agent={a.agent} />
                    <span className="flex flex-col">
                      <span className="text-[15px] font-semibold">{a.agent.name}</span>
                      <span className="text-[13px] text-ink2">{runsLabel(a.runs)}</span>
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="flex h-2.5 min-w-[120px] flex-[1_1_200px] overflow-hidden rounded-full bg-fill1"
                  >
                    <span className="bg-u-plg" style={{ width: `${(a.plg / widest) * 100}%` }} />
                    <span className="bg-u-seb" style={{ width: `${(a.seb / widest) * 100}%` }} />
                    <span
                      className="bg-fill2"
                      style={{ width: `${(a.unsplit / widest) * 100}%` }}
                    />
                  </span>
                  <span className="shrink-0 text-right text-[13px] text-ink2 tabular-nums min-[700px]:w-[210px]">
                    {a.plg + a.seb > 0
                      ? `${fmt(a.plg)} agent · ${fmt(a.seb)} data`
                      : "Not itemised"}
                  </span>
                  <span className="ml-auto shrink-0 text-right text-[15px] font-semibold tabular-nums min-[700px]:ml-0 min-[700px]:w-[96px]">
                    {fmt(a.total)} tk
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-[22px] font-bold">Runs</h2>
              <span className="text-[13px] text-ink2">
                Open a run to see what each charge was made of
              </span>
            </div>
            <UsageRuns runs={runs} />
            {usage.truncated && (
              <p className="text-[13px] text-ink2">
                Showing your 200 most recent runs in this period.
              </p>
            )}
          </section>
        </>
      )}

      <section className="flex flex-col gap-2 rounded-inner bg-fill1 px-4.5 py-4 text-[15px] leading-[22px] text-ink2">
        <p>
          Every figure in tk is a Sebtember token taken from your wallet. Under each charge you see
          the models that ran and their own input and output counts, so you can tell what a charge
          was made of. Sebtember serves your knowledge at cost. The same charges appear in
          Sebtember&apos;s usage, with Plugent named as the app.
        </p>
        {sum("unsplit") > 0 && (
          <p>
            {fmt(sum("unsplit"))} tk were charged before Plugent kept each charge line by line, so
            they count in the total but not in either meter.
          </p>
        )}
      </section>
    </main>
  );
}

function runsLabel(n: number) {
  return `${fmt(n)} ${n === 1 ? "run" : "runs"}`;
}

function Header({ period }: { period: PeriodId }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-[600px]">
        <PageHeader
          title="Usage"
          lead="The tokens your agents used from your Sebtember wallet. Top-ups and invoices stay on sebtember.app."
        />
      </div>
      <nav aria-label="Period" className="inline-flex gap-0.5 rounded-full bg-fill1 p-[3px]">
        {PERIODS.map((p) => (
          <Link
            key={p.id}
            href={p.id === "month" ? "/usage" : `/usage?period=${p.id}`}
            aria-current={p.id === period ? "page" : undefined}
            className={`inline-flex h-8 items-center rounded-full px-3.5 text-[14px] font-semibold ${
              p.id === period ? "bg-raised text-ink shadow-card" : "text-ink2 hover:text-ink"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function Tile({
  label,
  value,
  note,
  swatch,
}: {
  label: string;
  value: number | null;
  note: React.ReactNode;
  swatch?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-list bg-card px-5 py-4.5 shadow-card">
      <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink2">
        {swatch && <span className={`size-2.5 rounded-[3px] ${swatch}`} />}
        {label}
      </span>
      <span className="text-[28px] leading-[34px] font-bold tracking-[-0.02em] tabular-nums">
        {value === null ? "—" : fmt(value)}{" "}
        <span className="text-[15px] font-semibold text-ink2">tk</span>
      </span>
      <span className="text-[13px] text-ink2">{note}</span>
    </div>
  );
}
