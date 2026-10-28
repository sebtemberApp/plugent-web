import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnswerText } from "@/components/agents/AnswerText";
import { Logo } from "@/components/shell/Logo";
import { agentById } from "@/lib/agents/registry";
import { isIndexable, readShare, type SharedAnswer, type SharedSource } from "@/lib/shares";

/**
 * A shared answer (audit F1): the public, read-only snapshot `lib/shares.ts` froze. Signed-out
 * readers see it too; nothing here reads the run, the user or Sebtember.
 * ⚠️ Only a substantive, cited answer is indexable (Sebtember's Step-380 rule), and only on
 * production: dev.plugent.app never asks to be indexed.
 */
type Props = { params: Promise<{ token: string }> };

function plain(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const share = await readShare((await params).token).catch(() => null);
  if (!share) {
    return { title: "Answer not found · Plugent", robots: { index: false, follow: false } };
  }
  const title = clamp(share.question || plain(share.answer), 70);
  const description = clamp(plain(share.answer), 155);
  return {
    title: `${title} · Plugent`,
    description,
    robots: {
      index: process.env.VERCEL_ENV === "production" && isIndexable(share),
      follow: true,
    },
    openGraph: { title, description, type: "article", siteName: "Plugent" },
  };
}

function ownersOf(sources: SharedSource[]): { label: string; library: boolean }[] {
  const out: { label: string; library: boolean }[] = [];
  for (const s of sources) {
    const label = s.owner ?? (s.library ? "Library" : null);
    if (label && !out.some((o) => o.label === label)) out.push({ label, library: s.library });
  }
  return out;
}

function SourceCard({ source }: { source: SharedSource }) {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(source.fileName)?.[1]?.toUpperCase() ?? "FILE";
  return (
    <div className="flex gap-2.5 rounded-inner bg-fill1 p-3">
      <span className="flex h-10 w-8 shrink-0 items-center justify-center rounded-[6px] bg-card text-[10px] font-bold text-ink2 shadow-card">
        {ext.slice(0, 4)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-[6px] bg-fill2 px-1 text-[12px] font-semibold text-ink2">
            {source.n}
          </span>
          <span className="truncate text-[13px] font-semibold" title={source.fileName}>
            {source.fileName}
          </span>
        </span>
        {(source.page || source.owner || source.library) && (
          <span className="flex min-w-0 items-center gap-1 text-[12px] text-ink2">
            {source.page && <span className="shrink-0">p. {source.page}</span>}
            {source.page && (source.owner || source.library) && <span aria-hidden>·</span>}
            {source.library && (
              <BookOpen aria-hidden size={13} strokeWidth={2} className="shrink-0 text-k-lib" />
            )}
            {(source.owner || source.library) && (
              <span className={`truncate ${source.library ? "font-semibold text-k-lib" : ""}`}>
                {source.owner ?? "Library"}
              </span>
            )}
          </span>
        )}
      </span>
    </div>
  );
}

function Answer({ share }: { share: SharedAnswer }) {
  const owners = ownersOf(share.sources);
  return (
    <article className="flex flex-col gap-4 rounded-card bg-card px-6 py-5 shadow-card">
      <AnswerText text={share.answer} />
      {share.sources.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold text-ink2">Sources</span>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
            {share.sources.map((s) => (
              <SourceCard key={s.n} source={s} />
            ))}
          </div>
        </div>
      )}
      {owners.length > 0 && (
        <footer className="flex flex-wrap items-center gap-1.5 border-hair border-t-[0.5px] pt-3">
          <span className="text-[13px] text-ink2">Source:</span>
          {owners.map((o) => (
            <span
              key={o.label}
              className={`max-w-[220px] truncate rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${
                o.library ? "bg-k-lib/13 text-k-lib" : "bg-k-own/15 text-k-own"
              }`}
            >
              {o.label}
            </span>
          ))}
        </footer>
      )}
    </article>
  );
}

export default async function SharedAnswerPage({ params }: Props) {
  const share = await readShare((await params).token);
  if (!share) notFound();
  const agent = agentById(share.agent);
  const date = share.createdAt
    ? new Date(share.createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;

  return (
    <div className="min-h-dvh overflow-x-hidden">
      <header className="mx-auto flex max-w-[860px] items-center justify-between px-4 py-5 sm:px-8">
        <Link href="/" aria-label="Plugent home">
          <Logo className="h-7" />
        </Link>
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-full bg-act px-5 text-[15px] font-bold text-white hover:bg-act-press"
        >
          Try Plugent
        </Link>
      </header>
      <main className="mx-auto flex max-w-[860px] flex-col gap-5 px-4 pt-4 pb-16 sm:px-8">
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-semibold text-ink2">
            Shared answer · {agent.name}
            {date && ` · ${date}`}
          </p>
          {share.question && (
            <h1 className="text-[26px] leading-[34px] font-bold text-balance sm:text-[30px] sm:leading-[38px]">
              {share.question}
            </h1>
          )}
        </div>
        <Answer share={share} />
        <section className="mt-4 flex flex-col items-start gap-3 rounded-card bg-card p-6 shadow-card sm:flex-row sm:items-center">
          <div className="flex flex-1 flex-col gap-1">
            <h2 className="text-[18px] font-bold">Answers from your own documents</h2>
            <p className="text-[15px] leading-[22px] text-ink2">
              Plugent's agents work from the files you keep in sebtember.app, and every answer shows
              its sources.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex h-11 shrink-0 items-center rounded-full bg-act px-6 text-[15px] font-bold text-white hover:bg-act-press"
          >
            Get started
          </Link>
        </section>
      </main>
    </div>
  );
}
